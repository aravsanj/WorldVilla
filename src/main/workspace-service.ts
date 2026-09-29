import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import matter from 'gray-matter'
import { app, dialog } from 'electron'
import Database from 'better-sqlite3'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import { z } from 'zod'
import {
  type CreateLoreDocument,
  type LoreDocument,
  type LoreEntityType,
  type LoreReference,
  type LoreRenamePreview,
  type RenameMetadataReference,
  type LorePropertyPatch,
  type LoreSearchFilters,
  type LoreSearchResult,
  type LoreTreeNode,
  type CreateManuscriptContainer,
  type RenameManuscriptItem,
  type CreateScene,
  type CorkboardLayout,
  type GlobalSearchResult,
  type ManuscriptNode,
  type ManuscriptOrder,
  type ManuscriptExportFormat,
  type ManuscriptExportResult,
  type SceneDocument,
  type SceneMetadata,
  type SceneMetadataPatch,
  type SceneSnapshot,
  type SceneVariant,
  type CreateSceneVariant,
  type CreateTimelineEvent,
  type CreateStateTransition,
  type StateTransition,
  type ContinuityWarning,
  type CreateRelationship,
  type CreateRelationshipType,
  type Relationship,
  type RelationshipType,
  type RelationshipGraph,
  type RelationshipGraphPosition,
  type RelationshipGraphView,
  type RelationshipKind,
  type TimelineConfig,
  type TimelineEvent,
  type TimelineEventPatch,
  type TimelineTrack,
  type TimelineTrackKind,
  type SceneStatus,
  type RecentWorkspace,
  type WorkspaceChange,
  type WorkspaceManifest,
  type WorkspaceRescan,
  type WorkspaceSummary,
  workspaceManifestSchema
} from '../shared/workspace'

const MANIFEST_FILE = 'world.json'
const RECENTS_FILE = 'recent-workspaces.json'
const WORKSPACE_DIRECTORIES = ['lore', 'manuscript', 'media', 'maps', 'canvases', '.worldvilla', '.worldvilla/snapshots']

type SceneVariantManifest = {
  schemaVersion: 1
  preferredId: string
  variants: Array<Omit<SceneVariant, 'preferred'>>
}

export class WorkspaceService {
  private watcher: FSWatcher | null = null
  private activeWorkspace: WorkspaceSummary | null = null
  private database: Database.Database | null = null
  private indexTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly onChange: (change: WorkspaceChange) => void) {}

  private recentsPath(): string {
    return path.join(app.getPath('userData'), RECENTS_FILE)
  }

  async create(directory: string, name: string): Promise<WorkspaceSummary> {
    const root = path.resolve(directory)
    await mkdir(root, { recursive: true })

    const manifestPath = path.join(root, MANIFEST_FILE)
    try {
      await access(manifestPath)
      throw new Error('This folder already contains a WorldVilla workspace.')
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }

    const now = new Date().toISOString()
    const manifest: WorkspaceManifest = {
      formatVersion: 1,
      id: randomUUID(),
      name: name.trim(),
      createdAt: now,
      updatedAt: now
    }
    if (!manifest.name) throw new Error('A workspace name is required.')

    await Promise.all(WORKSPACE_DIRECTORIES.map((relativePath) => mkdir(path.join(root, relativePath), { recursive: true })))
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await writeFile(path.join(root, '.worldvilla', 'settings.json'), '{\n  "schemaVersion": 1\n}\n', 'utf8')

    const workspace = { ...manifest, path: root }
    await this.remember(workspace)
    await this.activate(workspace)
    return workspace
  }

  async open(directory: string): Promise<WorkspaceSummary> {
    const root = path.resolve(directory)
    const contents = await readFile(path.join(root, MANIFEST_FILE), 'utf8')
    const manifest = workspaceManifestSchema.parse(JSON.parse(contents))
    const workspace = { ...manifest, path: root }
    await this.remember(workspace)
    await this.activate(workspace)
    return workspace
  }

  async rescan(): Promise<WorkspaceRescan> {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    await this.rebuildSearchIndex()
    return {
      completedAt: new Date().toISOString(),
      fileCount: await countFiles(this.activeWorkspace.path)
    }
  }

  async searchLore(query: string, filters: LoreSearchFilters = {}): Promise<LoreSearchResult[]> {
    const terms = query.match(/[\p{L}\p{N}_-]+/gu)
    if (!terms?.length || !this.database) return []
    const ftsQuery = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
    const rows = this.database.prepare(`
      SELECT documents.path, documents.title, documents.type, documents.tags,
        snippet(lore_fts, 2, '<mark>', '</mark>', '…', 18) AS excerpt
      FROM lore_fts
      JOIN documents ON documents.path = lore_fts.path
      WHERE lore_fts MATCH @query
        AND (@type IS NULL OR documents.type = @type)
        AND (@folder IS NULL OR documents.path LIKE @folder)
        AND (@tag IS NULL OR documents.tags LIKE @tag)
      ORDER BY bm25(lore_fts), documents.title
      LIMIT 100
    `).all({
      query: ftsQuery,
      type: filters.type ?? null,
      folder: filters.folder ? `${filters.folder.replace(/^\/+|\/+$/g, '')}/%` : null,
      tag: filters.tag ? `%"${filters.tag.trim().toLocaleLowerCase()}"%` : null
    }) as Array<{ path: string, title: string, type: LoreEntityType, tags: string, excerpt: string }>
    return rows.map((row) => ({ ...row, tags: JSON.parse(row.tags) as string[] }))
  }

  async timeline(): Promise<{ config: TimelineConfig; events: TimelineEvent[]; tracks: TimelineTrack[]; states: StateTransition[] }> {
    return this.readTimeline()
  }

  async relationshipGraph(): Promise<RelationshipGraph> {
    return this.readRelationshipGraph()
  }

  async createRelationship(input: CreateRelationship): Promise<Relationship> {
    if (!input.fromPath || !input.toPath || input.fromPath === input.toPath) throw new Error('Choose two different lore entries.')
    if (!['parent', 'sibling', 'spouse', 'custom', 'partner', 'adoption', 'guardian', 'rivalry', 'allegiance', 'membership', 'ownership', 'succession'].includes(input.kind)) throw new Error('Unknown relationship type.')
    await Promise.all([input.fromPath.startsWith('unknown:') ? Promise.resolve() : this.readLoreDocument(input.fromPath), input.toPath.startsWith('unknown:') ? Promise.resolve() : this.readLoreDocument(input.toPath)])
    if ((input.fromPath.startsWith('unknown:') || input.toPath.startsWith('unknown:')) && input.kind !== 'parent') throw new Error('Unknown endpoints are only supported for parentage.')
    if (input.parentRole && (input.kind !== 'parent' || !['maternal', 'paternal'].includes(input.parentRole))) throw new Error('Parent role is only maternal or paternal.')
    const graph = await this.readRelationshipGraph()
    if (input.kind === 'custom' && (!input.customTypeId || !graph.customTypes.some((type) => type.id === input.customTypeId))) throw new Error('Choose a saved custom relationship type.')
    const relationship: Relationship = { id: randomUUID(), fromPath: input.fromPath, toPath: input.toPath, kind: input.kind, parentRole: input.parentRole || undefined, customTypeId: input.customTypeId || undefined, label: input.label?.trim() ?? '', notes: input.notes?.trim() ?? '', createdAt: new Date().toISOString() }
    graph.relationships.push(relationship)
    await this.writeRelationshipGraph(graph)
    return relationship
  }

  async updateRelationship(id: string, input: CreateRelationship): Promise<Relationship> {
    if (!input.fromPath || !input.toPath || input.fromPath === input.toPath) throw new Error('Choose two different lore entries.')
    if (!['parent', 'sibling', 'spouse', 'custom', 'partner', 'adoption', 'guardian', 'rivalry', 'allegiance', 'membership', 'ownership', 'succession'].includes(input.kind)) throw new Error('Unknown relationship type.')
    await Promise.all([input.fromPath.startsWith('unknown:') ? Promise.resolve() : this.readLoreDocument(input.fromPath), input.toPath.startsWith('unknown:') ? Promise.resolve() : this.readLoreDocument(input.toPath)])
    if ((input.fromPath.startsWith('unknown:') || input.toPath.startsWith('unknown:')) && input.kind !== 'parent') throw new Error('Unknown endpoints are only supported for parentage.')
    if (input.parentRole && (input.kind !== 'parent' || !['maternal', 'paternal'].includes(input.parentRole))) throw new Error('Parent role is only maternal or paternal.')
    const graph = await this.readRelationshipGraph()
    if (input.kind === 'custom' && (!input.customTypeId || !graph.customTypes.some((type) => type.id === input.customTypeId))) throw new Error('Choose a saved custom relationship type.')
    const index = graph.relationships.findIndex((relationship) => relationship.id === id)
    if (index < 0) throw new Error('Relationship not found.')
    const current = graph.relationships[index]
    const relationship: Relationship = { ...current, ...input, parentRole: input.parentRole || undefined, customTypeId: input.customTypeId || undefined, label: input.label?.trim() ?? '', notes: input.notes?.trim() ?? '' }
    graph.relationships[index] = relationship
    await this.writeRelationshipGraph(graph)
    return relationship
  }

  async deleteRelationship(id: string): Promise<void> {
    const graph = await this.readRelationshipGraph()
    const relationships = graph.relationships.filter((relationship) => relationship.id !== id)
    if (relationships.length === graph.relationships.length) throw new Error('Relationship not found.')
    await this.writeRelationshipGraph({ ...graph, relationships })
  }

  async createRelationshipType(input: CreateRelationshipType): Promise<RelationshipType> {
    const name = input.name.trim()
    if (!name) throw new Error('A relationship type needs a name.')
    const graph = await this.readRelationshipGraph()
    if (graph.customTypes.some((type) => type.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) throw new Error('That relationship type already exists.')
    const type = { id: randomUUID(), name }
    graph.customTypes.push(type)
    await this.writeRelationshipGraph(graph)
    return type
  }

  async deleteRelationshipType(id: string): Promise<void> {
    const graph = await this.readRelationshipGraph()
    if (graph.relationships.some((relationship) => relationship.customTypeId === id)) throw new Error('Remove or change relationships using this type first.')
    const customTypes = graph.customTypes.filter((type) => type.id !== id)
    if (customTypes.length === graph.customTypes.length) throw new Error('Relationship type not found.')
    await this.writeRelationshipGraph({ ...graph, customTypes })
  }

  async saveRelationshipPositions(positions: Record<string, RelationshipGraphPosition>): Promise<RelationshipGraph> {
    const graph = await this.readRelationshipGraph()
    const valid = Object.fromEntries(Object.entries(positions).filter(([, position]) => Number.isFinite(position.x) && Number.isFinite(position.y)))
    const next = { ...graph, positions: valid }
    await this.writeRelationshipGraph(next)
    return next
  }

  async saveRelationshipView(input: Omit<RelationshipGraphView, 'id'>): Promise<RelationshipGraphView> {
    if (!input.name.trim()) throw new Error('A saved view needs a name.')
    const graph = await this.readRelationshipGraph()
    const view: RelationshipGraphView = { id: randomUUID(), name: input.name.trim(), focusPath: input.focusPath || undefined, types: input.types }
    graph.views.push(view)
    await this.writeRelationshipGraph(graph)
    return view
  }

  async deleteRelationshipView(id: string): Promise<void> {
    const graph = await this.readRelationshipGraph()
    const views = graph.views.filter((view) => view.id !== id)
    if (views.length === graph.views.length) throw new Error('Saved view not found.')
    await this.writeRelationshipGraph({ ...graph, views })
  }

  async exportRelationshipGraph(): Promise<{ canceled: boolean; path?: string }> {
    const result = await dialog.showSaveDialog({ title: 'Export relationships', defaultPath: 'relationships.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return { canceled: true }
    await writeFile(result.filePath, `${JSON.stringify(await this.readRelationshipGraph(), null, 2)}\n`, 'utf8')
    return { canceled: false, path: result.filePath }
  }

  async importRelationshipGraph(): Promise<RelationshipGraph | null> {
    const result = await dialog.showOpenDialog({ title: 'Import relationships', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) return null
    const graph = relationshipGraphFromValue(JSON.parse(await readFile(result.filePaths[0], 'utf8')))
    await this.writeRelationshipGraph(graph)
    return graph
  }

  async saveTimelineConfig(config: TimelineConfig): Promise<TimelineConfig> {
    assertMasterDate(config.masterStartDate)
    assertMasterDate(config.masterEndDate)
    if (config.masterStartDate > config.masterEndDate) throw new Error('The master timeline start must be before its end.')
    for (const calendar of config.calendars ?? []) {
      if (!calendar.id || !calendar.name.trim() || !calendar.eraLabel.trim() || !calendar.months.length || calendar.months.some((month) => !month.name.trim() || !Number.isInteger(month.days) || month.days < 1)) throw new Error('Each calendar needs a name, era label, and valid named months.')
      assertMasterDate(calendar.epochMasterDate)
    }
    const timeline = await this.readTimeline()
    const outside = timeline.events.find((event) => event.masterDate.slice(0, 10) < config.masterStartDate || (event.masterEndDate ?? event.masterDate).slice(0, 10) > config.masterEndDate)
    if (outside) throw new Error(`“${outside.title}” falls outside the proposed master reference span.`)
    const normalized = { ...config, calendars: [] }
    await this.writeTimeline({ ...timeline, config: normalized })
    return normalized
  }

  async createTimelineEvent(input: CreateTimelineEvent): Promise<TimelineEvent> {
    const title = input.title.trim()
    if (!title) throw new Error('An event title is required.')
    const timeline = await this.readTimeline()
    validateEventInterval(input.masterDate, input.masterEndDate, timeline.config)
    const placePaths = uniqueStrings(input.placePaths)
    if (!placePaths.length) throw new Error('Every event needs at least one Place.')
    const now = new Date().toISOString()
    const event: TimelineEvent = { id: randomUUID(), title, masterDate: input.masterDate, masterEndDate: input.masterEndDate?.trim() || undefined, inWorldDate: input.inWorldDate?.trim() || undefined, tracks: uniqueStrings(input.tracks), storyTags: uniqueStrings(input.storyTags), placePaths, characterPaths: uniqueStrings(input.characterPaths), scenePaths: uniqueStrings(input.scenePaths), lorePaths: uniqueStrings(input.lorePaths), notes: input.notes?.trim() ?? '', createdAt: now, updatedAt: now }
    event.tracks = await this.eventTracks(event, timeline.tracks)
    timeline.events.push(event)
    timeline.tracks = await this.mergeTimelineTracks(timeline.tracks, event)
    await this.writeTimeline(timeline)
    return event
  }

  async deleteTimelineEvent(id: string): Promise<void> {
    const timeline = await this.readTimeline()
    const events = timeline.events.filter((event) => event.id !== id)
    if (events.length === timeline.events.length) throw new Error('Timeline event not found.')
    await this.writeTimeline({ ...timeline, events })
  }

  async createStateTransition(input: CreateStateTransition): Promise<StateTransition> {
    if (!input.subjectPath || !input.to.trim()) throw new Error('A subject and new state are required.')
    if (!['holder', 'location', 'lifeStatus', 'allegiance'].includes(input.field)) throw new Error('Unknown state field.')
    const timeline = await this.readTimeline()
    assertMasterDateTime(input.effectiveDate)
    assertDateWithinMasterSpan(input.effectiveDate, timeline.config)
    if (input.eventId && !timeline.events.some((event) => event.id === input.eventId)) throw new Error('The linked event does not exist.')
    const transition: StateTransition = { ...input, id: randomUUID(), to: input.to.trim(), from: input.from?.trim() || undefined, notes: input.notes.trim(), eventId: input.eventId || undefined, createdAt: new Date().toISOString() }
    timeline.states.push(transition)
    await this.writeTimeline(timeline)
    return transition
  }

  async deleteStateTransition(id: string): Promise<void> {
    const timeline = await this.readTimeline()
    const states = timeline.states.filter((state) => state.id !== id)
    if (states.length === timeline.states.length) throw new Error('State transition not found.')
    await this.writeTimeline({ ...timeline, states })
  }

  async continuityWarnings(): Promise<ContinuityWarning[]> {
    const { states } = await this.readTimeline()
    const warnings: ContinuityWarning[] = []
    for (const field of ['holder', 'location', 'lifeStatus', 'allegiance'] as const) {
      const relevant = states.filter((state) => state.field === field)
      const simultaneous = new Map<string, StateTransition[]>()
      relevant.forEach((state) => { const key = `${state.subjectPath}::${state.effectiveDate}`; simultaneous.set(key, [...(simultaneous.get(key) ?? []), state]) })
      simultaneous.forEach((entries) => { const values = new Set(entries.map((entry) => entry.to)); if (values.size > 1) warnings.push({ transitionIds: entries.map((entry) => entry.id), message: `Conflicting ${field} states are recorded for the same subject and time.` }) })
      const bySubject = new Map<string, StateTransition[]>()
      relevant.forEach((state) => bySubject.set(state.subjectPath, [...(bySubject.get(state.subjectPath) ?? []), state]))
      bySubject.forEach((entries) => entries.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate)).slice(1).forEach((entry, index) => { const previous = entries[index]; if (entry.from && previous.to !== entry.from) warnings.push({ transitionIds: [previous.id, entry.id], message: `The recorded prior ${field} does not match the preceding state.` }) }))
    }
    return warnings
  }

  async updateTimelineEvent(id: string, patch: TimelineEventPatch): Promise<TimelineEvent> {
    const timeline = await this.readTimeline()
    const index = timeline.events.findIndex((event) => event.id === id)
    if (index < 0) throw new Error('Timeline event not found.')
    const current = timeline.events[index]
    const next: TimelineEvent = { ...current, ...patch, title: patch.title === undefined ? current.title : patch.title.trim(), inWorldDate: patch.inWorldDate === undefined ? current.inWorldDate : patch.inWorldDate.trim() || undefined, tracks: patch.tracks === undefined ? current.tracks : uniqueStrings(patch.tracks), storyTags: patch.storyTags === undefined ? current.storyTags ?? [] : uniqueStrings(patch.storyTags), placePaths: patch.placePaths === undefined ? current.placePaths : uniqueStrings(patch.placePaths), characterPaths: patch.characterPaths === undefined ? current.characterPaths : uniqueStrings(patch.characterPaths), scenePaths: patch.scenePaths === undefined ? current.scenePaths : uniqueStrings(patch.scenePaths), lorePaths: patch.lorePaths === undefined ? current.lorePaths : uniqueStrings(patch.lorePaths), notes: patch.notes === undefined ? current.notes : patch.notes.trim(), updatedAt: new Date().toISOString() }
    if (!next.title) throw new Error('An event title is required.')
    validateEventInterval(next.masterDate, next.masterEndDate, timeline.config)
    if (!next.placePaths.length) throw new Error('Every event needs at least one Place.')
    next.tracks = await this.eventTracks(next, timeline.tracks)
    timeline.events[index] = next
    timeline.tracks = await this.mergeTimelineTracks(timeline.tracks, next)
    await this.writeTimeline(timeline)
    return next
  }

  async searchGlobal(query: string): Promise<GlobalSearchResult[]> {
    const terms = query.toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu)
    if (!terms?.length) return []
    const lore = await this.searchLore(query)
    const scenePaths = await findManuscriptScenes(this.manuscriptRoot())
    const scenes = await Promise.all(scenePaths.map(async (fullPath): Promise<GlobalSearchResult | null> => {
      const raw = await readFile(fullPath, 'utf8')
      const parsed = matter(raw)
      const haystack = `${JSON.stringify(parsed.data)}\n${parsed.content}`.toLocaleLowerCase()
      if (!terms.every((term) => haystack.includes(term))) return null
      const title = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : titleFromSegment(path.basename(fullPath, '.md'))
      const index = haystack.indexOf(terms[0])
      const excerpt = parsed.content.replace(/\s+/gu, ' ').slice(Math.max(0, index - 80), index + 180).trim() || title
      return { source: 'manuscript', path: this.manuscriptRelativePath(fullPath), title, type: `scene${typeof parsed.data.pov === 'string' && parsed.data.pov ? ` · ${parsed.data.pov}` : ''}`, tags: stringArray(parsed.data.tags), excerpt }
    }))
    const results = [...lore.map((result) => ({ ...result, source: 'lore' as const })), ...scenes.filter((result): result is GlobalSearchResult => result !== null)]
    return results.sort((left, right) => searchRank(right, terms) - searchRank(left, terms) || left.title.localeCompare(right.title)).slice(0, 100)
  }

  async listLore(): Promise<LoreTreeNode[]> {
    const root = this.loreRoot()
    return readLoreTree(root, '')
  }

  async listLoreReferences(): Promise<LoreReference[]> {
    const root = this.loreRoot()
    const documentPaths = await findLoreDocuments(root)
    const references = await Promise.all(documentPaths.map(async (fullPath): Promise<LoreReference> => {
      const content = await readFile(fullPath, 'utf8')
      const parsed = matter(content)
      const fallbackTitle = path.basename(fullPath, '.md').replaceAll('-', ' ')
      return { path: this.loreRelativePath(fullPath), title: typeof parsed.data.title === 'string' ? parsed.data.title : fallbackTitle, type: validEntityTypeOrNote(parsed.data.type) }
    }))
    return references.sort((left, right) => left.title.localeCompare(right.title))
  }

  async listBacklinks(relativePath: string): Promise<LoreReference[]> {
    const target = await this.readLoreDocument(relativePath)
    const documentPaths = await findLoreDocuments(this.loreRoot())
    const backlinks = await Promise.all(documentPaths.map(async (fullPath): Promise<LoreReference | null> => {
      const sourcePath = this.loreRelativePath(fullPath)
      if (sourcePath === target.path) return null
      const source = matter(await readFile(fullPath, 'utf8'))
      if (!containsWikiReference(source.content, target)) return null
      const fallbackTitle = path.basename(fullPath, '.md').replaceAll('-', ' ')
      return { path: sourcePath, title: typeof source.data.title === 'string' ? source.data.title : fallbackTitle }
    }))
    return backlinks.filter((link): link is LoreReference => link !== null).sort((left, right) => left.title.localeCompare(right.title))
  }

  async readLoreDocument(relativePath: string): Promise<LoreDocument> {
    const fullPath = this.lorePath(relativePath, true)
    const content = await readFile(fullPath, 'utf8')
    const parsed = matter(content)
    const fallbackTitle = path.basename(fullPath, '.md').replaceAll('-', ' ')
    return {
      path: this.loreRelativePath(fullPath),
      title: typeof parsed.data.title === 'string' ? parsed.data.title : fallbackTitle,
      content,
      frontmatter: parsed.data
    }
  }

  async saveLoreDocument(relativePath: string, content: string): Promise<LoreDocument> {
    if (typeof content !== 'string') throw new Error('Document content must be text.')
    const original = await this.readLoreDocument(relativePath)
    const parsed = matter(content)
    const requestedTitle = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : original.title
    const fullPath = this.lorePath(relativePath, true)
    const expectedPath = path.join(path.dirname(fullPath), `${safeSegment(requestedTitle)}.md`)
    if (requestedTitle !== original.title || expectedPath !== fullPath) return this.renameLoreDocument(relativePath, requestedTitle, content)
    await writeAtomically(fullPath, content)
    return this.readLoreDocument(relativePath)
  }

  async updateLoreProperties(relativePath: string, patch: LorePropertyPatch, content?: string): Promise<LoreDocument> {
    const original = content ?? await readFile(this.lorePath(relativePath, true), 'utf8')
    const parsed = matter(original)
    const title = patch.title?.trim()
    if (patch.title !== undefined && !title) throw new Error('A title is required.')
    const type = patch.type === undefined ? parsed.data.type : validEntityType(patch.type)
    const tags = patch.tags === undefined ? parsed.data.tags : patch.tags.map((tag) => tag.trim()).filter(Boolean)
    const updated = matter.stringify(parsed.content, { ...parsed.data, ...(title ? { title } : {}), type, tags })
    return this.saveLoreDocument(relativePath, updated)
  }

  async previewLoreRename(relativePath: string, title: string): Promise<LoreRenamePreview> {
    const original = await this.readLoreDocument(relativePath)
    const newTitle = title.trim()
    if (!newTitle) throw new Error('A document name is required.')
    const oldTargetPath = original.path.replace(/\.md$/, '')
    const documents = await Promise.all((await findLoreDocuments(this.loreRoot())).map(async (fullPath): Promise<LoreReference | null> => {
      const raw = await readFile(fullPath, 'utf8')
      if (replaceWikiTargets(raw, original.title, oldTargetPath, newTitle) === raw) return null
      const parsed = matter(raw)
      return { path: this.loreRelativePath(fullPath), title: typeof parsed.data.title === 'string' ? parsed.data.title : path.basename(fullPath, '.md') }
    }))
    const metadata = await Promise.all([
      ...(await findLoreDocuments(this.loreRoot())).map((fullPath) => metadataRenameReference(fullPath, 'lore', this.loreRelativePath(fullPath), original.title)),
      ...(await findManuscriptScenes(this.manuscriptRoot())).map((fullPath) => metadataRenameReference(fullPath, 'manuscript', this.manuscriptRelativePath(fullPath), original.title))
    ])
    return { oldTitle: original.title, newTitle, affectedReferences: documents.filter((document): document is LoreReference => document !== null), affectedMetadata: metadata.filter((entry): entry is RenameMetadataReference => entry !== null) }
  }

  async renameLoreDocument(relativePath: string, title: string, replacementContent?: string): Promise<LoreDocument> {
    const original = await this.readLoreDocument(relativePath)
    const newTitle = title.trim()
    if (!newTitle) throw new Error('A document name is required.')

    const oldFullPath = this.lorePath(relativePath, true)
    const newFullPath = path.join(path.dirname(oldFullPath), `${safeSegment(newTitle)}.md`)
    if (!isWithin(this.loreRoot(), newFullPath)) throw new Error('Invalid document location.')
    if (newFullPath !== oldFullPath) {
      try {
        await access(newFullPath)
        throw new Error('A document with that name already exists.')
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
    }

    const oldTargetPath = original.path.replace(/\.md$/, '')
    const documentPaths = await findLoreDocuments(this.loreRoot())
    await Promise.all(documentPaths.map(async (fullPath) => {
      const raw = fullPath === oldFullPath && replacementContent !== undefined ? replacementContent : await readFile(fullPath, 'utf8')
      const rewritten = replaceWikiTargets(raw, original.title, oldTargetPath, newTitle)
      if (fullPath === oldFullPath) {
        const parsed = matter(rewritten)
        await writeAtomically(fullPath, matter.stringify(parsed.content, { ...parsed.data, title: newTitle }))
      } else if (rewritten !== raw) {
        await writeAtomically(fullPath, rewritten)
      }
    }))
    if (newFullPath !== oldFullPath) await rename(oldFullPath, newFullPath)
    await Promise.all([...(await findLoreDocuments(this.loreRoot())), ...(await findManuscriptScenes(this.manuscriptRoot()))].map(async (fullPath) => {
      const raw = await readFile(fullPath, 'utf8')
      const parsed = matter(raw)
      const data = renameMetadataValues(parsed.data, original.title, newTitle)
      if (data !== parsed.data) await writeAtomically(fullPath, matter.stringify(parsed.content, data))
    }))
    return this.readLoreDocument(this.loreRelativePath(newFullPath))
  }

  async moveLoreDocument(relativePath: string, destinationFolder: string): Promise<LoreDocument> {
    const source = this.lorePath(relativePath, true)
    const destination = this.lorePath(destinationFolder, false)
    if (!(await stat(destination)).isDirectory()) throw new Error('Choose a lore folder as the destination.')
    const target = path.join(destination, path.basename(source))
    if (!isWithin(this.loreRoot(), target)) throw new Error('Invalid document location.')
    if (target !== source) {
      try {
        await access(target)
        throw new Error('A document with that name already exists in the destination folder.')
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      await rename(source, target)
      await this.rewriteWikiPaths(relativePath.replace(/\.md$/, ''), this.loreRelativePath(target).replace(/\.md$/, ''))
    }
    return this.readLoreDocument(this.loreRelativePath(target))
  }

  async deleteLoreDocument(relativePath: string): Promise<void> {
    await rm(this.lorePath(relativePath, true))
  }

  async renameLoreFolder(relativePath: string, name: string): Promise<string> {
    const source = this.lorePath(relativePath, false)
    if (source === this.loreRoot()) throw new Error('The root lore folder cannot be renamed.')
    const target = path.join(path.dirname(source), safeSegment(name))
    await this.moveLorePath(source, target)
    await this.rewriteWikiPaths(relativePath, this.loreRelativePath(target))
    return this.loreRelativePath(target)
  }

  async moveLoreFolder(relativePath: string, destinationFolder: string): Promise<string> {
    const source = this.lorePath(relativePath, false)
    if (source === this.loreRoot()) throw new Error('The root lore folder cannot be moved.')
    const destination = this.lorePath(destinationFolder, false)
    const target = path.join(destination, path.basename(source))
    if (isWithin(source, destination)) throw new Error('A folder cannot be moved into itself.')
    await this.moveLorePath(source, target)
    await this.rewriteWikiPaths(relativePath, this.loreRelativePath(target))
    return this.loreRelativePath(target)
  }

  async deleteLoreFolder(relativePath: string): Promise<void> {
    const folder = this.lorePath(relativePath, false)
    if (folder === this.loreRoot()) throw new Error('The root lore folder cannot be deleted.')
    await rm(folder, { recursive: true })
  }

  async createLoreDocument(input: CreateLoreDocument): Promise<LoreDocument> {
    const parent = this.lorePath(input.parentPath, false)
    const filename = `${safeSegment(input.name)}.md`
    const fullPath = path.join(parent, filename)
    if (!isWithin(this.loreRoot(), fullPath)) throw new Error('Invalid document location.')
    try {
      await access(fullPath)
      throw new Error('A document with that name already exists.')
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }

    const type = validEntityType(input.type)
    const title = input.name.trim()
    if (!title) throw new Error('A document name is required.')
    const content = matter.stringify('', { id: randomUUID(), type, title, tags: [] })
    await mkdir(parent, { recursive: true })
    await writeAtomically(fullPath, content)
    return this.readLoreDocument(this.loreRelativePath(fullPath))
  }

  async createLoreFolder(parentPath: string, name: string): Promise<LoreTreeNode[]> {
    const parent = this.lorePath(parentPath, false)
    await mkdir(path.join(parent, safeSegment(name)), { recursive: false })
    return this.listLore()
  }

  async listManuscript(): Promise<ManuscriptNode[]> {
    return readManuscriptTree(this.manuscriptRoot(), '', await this.readManuscriptOrder())
  }

  async exportManuscript(relativePath: string, format: ManuscriptExportFormat): Promise<ManuscriptExportResult> {
    if (!['markdown', 'html', 'docx'].includes(format)) throw new Error('Unsupported export format.')
    const target = this.manuscriptPath(relativePath, false)
    const details = await stat(target)
    const scenePaths = details.isDirectory() ? await findManuscriptScenes(target) : [this.manuscriptPath(relativePath, true)]
    const scenes = await Promise.all(scenePaths.map(async (fullPath) => sceneFromFile(fullPath, this.manuscriptRelativePath(fullPath))))
    const markdown = scenes.map((scene) => `# ${scene.title}\n\n${matter(scene.content).content.trim()}\n`).join('\n')
    const extension = format === 'markdown' ? 'md' : format
    const defaultName = `${safeSegment(path.basename(relativePath || 'manuscript', '.md')) || 'manuscript'}.${extension}`
    const result = await dialog.showSaveDialog({ title: 'Export manuscript selection', defaultPath: path.join(this.activeWorkspace?.path ?? '', defaultName), filters: [{ name: format === 'markdown' ? 'Markdown' : format === 'html' ? 'HTML' : 'Word document', extensions: [extension] }] })
    if (result.canceled || !result.filePath) return { canceled: true, sceneCount: scenes.length }
    const contents = format === 'markdown' ? markdown : format === 'html' ? manuscriptHtml(markdown) : await manuscriptDocx(markdown)
    await writeFile(result.filePath, contents)
    return { canceled: false, path: result.filePath, sceneCount: scenes.length }
  }

  async corkboardLayout(): Promise<CorkboardLayout> {
    try {
      const parsed = JSON.parse(await readFile(this.corkboardLayoutPath(), 'utf8')) as Partial<CorkboardLayout>
      if (parsed.schemaVersion === 1 && Array.isArray(parsed.cardOrder) && parsed.cardOrder.every((id) => typeof id === 'string')) return { schemaVersion: 1, cardOrder: parsed.cardOrder }
    } catch { /* Return the default layout below. */ }
    return { schemaVersion: 1, cardOrder: [] }
  }

  async saveCorkboardLayout(layout: CorkboardLayout): Promise<CorkboardLayout> {
    if (layout.schemaVersion !== 1 || !Array.isArray(layout.cardOrder) || layout.cardOrder.some((id) => typeof id !== 'string')) throw new Error('Invalid corkboard layout.')
    await writeAtomically(this.corkboardLayoutPath(), `${JSON.stringify(layout, null, 2)}\n`)
    return layout
  }

  async reorderManuscript(parentPath: string, orderedPaths: string[]): Promise<ManuscriptNode[]> {
    const parent = this.manuscriptPath(parentPath, false)
    const entries = await readdir(parent, { withFileTypes: true })
    const children = entries.filter((entry) => entry.isDirectory() || entry.name.endsWith('.md')).map((entry) => parentPath ? `${parentPath}/${entry.name}` : entry.name)
    if (children.length !== orderedPaths.length || new Set(orderedPaths).size !== children.length || orderedPaths.some((entry) => !children.includes(entry))) throw new Error('The binder order does not match this folder.')
    const order = await this.readManuscriptOrder()
    order[parentPath] = orderedPaths
    await writeAtomically(this.manuscriptOrderPath(), `${JSON.stringify({ schemaVersion: 1, order }, null, 2)}\n`)
    return this.listManuscript()
  }

  async createManuscriptContainer(input: CreateManuscriptContainer): Promise<ManuscriptNode[]> {
    const parent = this.manuscriptPath(input.parentPath, false)
    const depth = input.parentPath ? input.parentPath.split('/').length : 0
    const expectedKinds: Array<Exclude<import('../shared/workspace').ManuscriptNodeKind, 'scene'>> = ['volume', 'part', 'chapter']
    if (input.kind !== expectedKinds[depth]) throw new Error(`A ${expectedKinds[depth] ?? 'scene'} cannot be created here.`)
    const title = input.title.trim()
    if (!title) throw new Error('A title is required.')
    await mkdir(path.join(parent, safeSegment(title)), { recursive: false })
    return this.listManuscript()
  }

  async renameManuscriptItem(input: RenameManuscriptItem): Promise<string> {
    const source = this.manuscriptPath(input.path, false)
    const details = await stat(source)
    if (!details.isDirectory() && !input.path.endsWith('.md')) throw new Error('Invalid manuscript item.')
    const title = input.title.trim()
    if (!title) throw new Error('A title is required.')
    const target = path.join(path.dirname(source), details.isDirectory() ? safeSegment(title) : `${safeSegment(title)}.md`)
    if (target !== source) {
      try { await access(target); throw new Error('A manuscript item with that title already exists.') } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error }
      await rename(source, target)
    }
    const nextPath = this.manuscriptRelativePath(target)
    if (!details.isDirectory()) {
      const parsed = matter(await readFile(target, 'utf8'))
      await writeAtomically(target, matter.stringify(parsed.content, { ...parsed.data, title }))
      const renamedScene = await this.readScene(this.manuscriptRelativePath(target))
      const manifest = await this.ensureSceneVariants(renamedScene)
      await Promise.all(manifest.variants.map(async (variant) => {
        const variantPath = this.sceneVariantPath(renamedScene.id, variant.id)
        const variantContent = matter(await readFile(variantPath, 'utf8'))
        await writeAtomically(variantPath, matter.stringify(variantContent.content, { ...variantContent.data, title }))
      }))
    }
    const rewritePath = (entry: string): string => entry === input.path ? nextPath : entry.startsWith(`${input.path}/`) ? `${nextPath}${entry.slice(input.path.length)}` : entry
    const order = await this.readManuscriptOrder()
    const renamedOrder = Object.fromEntries(Object.entries(order).map(([parent, children]) => [rewritePath(parent), children.map(rewritePath)]))
    await writeAtomically(this.manuscriptOrderPath(), `${JSON.stringify({ schemaVersion: 1, order: renamedOrder }, null, 2)}\n`)
    return nextPath
  }

  async createScene(input: CreateScene): Promise<SceneDocument> {
    const parent = this.manuscriptPath(input.parentPath, false)
    if (input.parentPath.split('/').filter(Boolean).length !== 3) throw new Error('Scenes must be created inside a chapter.')
    const title = input.title.trim()
    if (!title) throw new Error('A scene title is required.')
    const fullPath = path.join(parent, `${safeSegment(title)}.md`)
    if (!isWithin(this.manuscriptRoot(), fullPath)) throw new Error('Invalid manuscript path.')
    try { await access(fullPath); throw new Error('A scene with that title already exists.') } catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error }
    const content = matter.stringify('', { id: randomUUID(), title, pov: input.pov?.trim() ?? '', inWorldDate: '', locations: [], characters: [], status: input.status ?? 'idea', tags: [] })
    await writeAtomically(fullPath, content)
    return this.readScene(this.manuscriptRelativePath(fullPath))
  }

  async readScene(relativePath: string): Promise<SceneDocument> {
    const fullPath = this.manuscriptPath(relativePath, true)
    return sceneFromFile(fullPath, this.manuscriptRelativePath(fullPath))
  }

  async updateSceneMetadata(relativePath: string, patch: SceneMetadataPatch, content?: string): Promise<SceneDocument> {
    const current = content ?? await readFile(this.manuscriptPath(relativePath, true), 'utf8')
    const parsed = matter(current)
    const metadata = await this.readScene(relativePath)
    const update = {
      pov: patch.pov === undefined ? metadata.metadata.pov : patch.pov.trim(),
      inWorldDate: patch.inWorldDate === undefined ? metadata.metadata.inWorldDate : patch.inWorldDate.trim(),
      locations: patch.locations === undefined ? metadata.metadata.locations : patch.locations.map((value) => value.trim()).filter(Boolean),
      characters: patch.characters === undefined ? metadata.metadata.characters : patch.characters.map((value) => value.trim()).filter(Boolean),
      status: patch.status === undefined ? metadata.metadata.status : validSceneStatus(patch.status),
      tags: patch.tags === undefined ? metadata.metadata.tags : patch.tags.map((value) => value.trim()).filter(Boolean)
    }
    return this.saveScene(relativePath, matter.stringify(parsed.content, { ...parsed.data, ...update }))
  }

  async listSceneVariants(relativePath: string): Promise<SceneVariant[]> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    return manifest.variants.map((variant) => ({ ...variant, preferred: variant.id === manifest.preferredId }))
  }

  async readSceneVariant(relativePath: string, variantId: string): Promise<SceneDocument> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    if (!manifest.variants.some((variant) => variant.id === variantId)) throw new Error('Unknown scene variant.')
    return sceneFromContent(await readFile(this.sceneVariantPath(scene.id, variantId), 'utf8'), scene.path, scene.title)
  }

  async createSceneVariant(relativePath: string, input: CreateSceneVariant): Promise<SceneVariant[]> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    const name = input.name.trim()
    if (!name) throw new Error('A version name is required.')
    if (manifest.variants.some((variant) => variant.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('A version with that name already exists.')
    const sourceId = input.sourceVariantId ?? manifest.preferredId
    if (!manifest.variants.some((variant) => variant.id === sourceId)) throw new Error('Unknown source version.')
    const id = randomUUID()
    const now = new Date().toISOString()
    await writeAtomically(this.sceneVariantPath(scene.id, id), await readFile(this.sceneVariantPath(scene.id, sourceId), 'utf8'))
    manifest.variants.push({ id, name, createdAt: now, updatedAt: now, wordCount: scene.metadata.wordCount })
    await this.writeSceneVariantManifest(scene.id, manifest)
    return manifest.variants.map((variant) => ({ ...variant, preferred: variant.id === manifest.preferredId }))
  }

  async renameSceneVariant(relativePath: string, variantId: string, name: string): Promise<SceneVariant[]> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    const variant = manifest.variants.find((entry) => entry.id === variantId)
    const nextName = name.trim()
    if (!variant) throw new Error('Unknown scene variant.')
    if (!nextName) throw new Error('A version name is required.')
    if (manifest.variants.some((entry) => entry.id !== variantId && entry.name.toLocaleLowerCase() === nextName.toLocaleLowerCase())) throw new Error('A version with that name already exists.')
    variant.name = nextName
    variant.updatedAt = new Date().toISOString()
    await this.writeSceneVariantManifest(scene.id, manifest)
    return manifest.variants.map((entry) => ({ ...entry, preferred: entry.id === manifest.preferredId }))
  }

  async updateSceneVariantMetadata(relativePath: string, variantId: string, patch: SceneMetadataPatch, content?: string): Promise<SceneDocument> {
    const variant = await this.readSceneVariant(relativePath, variantId)
    const parsed = matter(content ?? variant.content)
    const update = {
      pov: patch.pov === undefined ? variant.metadata.pov : patch.pov.trim(),
      inWorldDate: patch.inWorldDate === undefined ? variant.metadata.inWorldDate : patch.inWorldDate.trim(),
      locations: patch.locations === undefined ? variant.metadata.locations : patch.locations.map((value) => value.trim()).filter(Boolean),
      characters: patch.characters === undefined ? variant.metadata.characters : patch.characters.map((value) => value.trim()).filter(Boolean),
      status: patch.status === undefined ? variant.metadata.status : validSceneStatus(patch.status),
      tags: patch.tags === undefined ? variant.metadata.tags : patch.tags.map((value) => value.trim()).filter(Boolean)
    }
    return this.saveSceneVariant(relativePath, variantId, matter.stringify(parsed.content, { ...parsed.data, ...update }))
  }

  async saveSceneVariant(relativePath: string, variantId: string, content: string): Promise<SceneDocument> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    const variant = manifest.variants.find((entry) => entry.id === variantId)
    if (!variant) throw new Error('Unknown scene variant.')
    const parsed = matter(content)
    const normalized = matter.stringify(parsed.content, { ...parsed.data, id: scene.id, title: scene.title, wordCount: countWords(parsed.content) })
    await writeAtomically(this.sceneVariantPath(scene.id, variantId), normalized)
    variant.updatedAt = new Date().toISOString()
    variant.wordCount = countWords(parsed.content)
    await this.writeSceneVariantManifest(scene.id, manifest)
    if (manifest.preferredId === variantId) await writeAtomically(this.manuscriptPath(scene.path, true), normalized)
    return sceneFromContent(normalized, scene.path, scene.title)
  }

  async setPreferredSceneVariant(relativePath: string, variantId: string): Promise<SceneDocument> {
    const scene = await this.readScene(relativePath)
    const manifest = await this.ensureSceneVariants(scene)
    if (!manifest.variants.some((variant) => variant.id === variantId)) throw new Error('Unknown scene variant.')
    const content = await readFile(this.sceneVariantPath(scene.id, variantId), 'utf8')
    manifest.preferredId = variantId
    await this.writeSceneVariantManifest(scene.id, manifest)
    await writeAtomically(this.manuscriptPath(scene.path, true), content)
    return this.readScene(scene.path)
  }

  async listSceneSnapshots(relativePath: string): Promise<SceneSnapshot[]> {
    const scene = await this.readScene(relativePath)
    const directory = this.sceneSnapshotDirectory(scene.id)
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      const snapshots = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map(async (entry) => {
        const fullPath = path.join(directory, entry.name)
        const [contents, details] = await Promise.all([readFile(fullPath, 'utf8'), stat(fullPath)])
        return { id: entry.name.slice(0, -3), createdAt: details.mtime.toISOString(), wordCount: countWords(contents) }
      }))
      return snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    } catch { return [] }
  }

  async readSceneSnapshot(relativePath: string, snapshotId: string): Promise<string> {
    if (!/^[\w-]+$/u.test(snapshotId)) throw new Error('Invalid snapshot.')
    const scene = await this.readScene(relativePath)
    const directory = this.sceneSnapshotDirectory(scene.id)
    const snapshot = path.join(directory, `${snapshotId}.md`)
    if (!isWithin(directory, snapshot)) throw new Error('Invalid snapshot.')
    return readFile(snapshot, 'utf8')
  }

  async createSceneVersion(relativePath: string, content?: string): Promise<SceneDocument> {
    const saved = content === undefined ? await this.readScene(relativePath) : await this.saveScene(relativePath, content)
    await this.snapshotScene(saved.id, await readFile(this.manuscriptPath(saved.path, true), 'utf8'))
    return saved
  }

  async restoreSceneSnapshot(relativePath: string, snapshotId: string): Promise<SceneDocument> {
    const current = await this.readScene(relativePath)
    await this.snapshotScene(current.id, await readFile(this.manuscriptPath(relativePath, true), 'utf8'))
    return this.saveScene(relativePath, await this.readSceneSnapshot(relativePath, snapshotId))
  }

  async saveScene(relativePath: string, content: string): Promise<SceneDocument> {
    if (typeof content !== 'string') throw new Error('Scene content must be text.')
    const fullPath = this.manuscriptPath(relativePath, true)
    const parsed = matter(content)
    const original = await this.readScene(relativePath)
    const title = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : original.title
    const target = path.join(path.dirname(fullPath), `${safeSegment(title)}.md`)
    if (!isWithin(this.manuscriptRoot(), target)) throw new Error('Invalid manuscript path.')
    const normalized = matter.stringify(parsed.content, { ...parsed.data, id: typeof parsed.data.id === 'string' ? parsed.data.id : original.id, title, wordCount: countWords(parsed.content) })
    if (target !== fullPath) await rename(fullPath, target)
    await writeAtomically(target, normalized)
    const saved = await this.readScene(this.manuscriptRelativePath(target))
    const manifest = await this.ensureSceneVariants(saved)
    await writeAtomically(this.sceneVariantPath(saved.id, manifest.preferredId), normalized)
    return saved
  }

  async close(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
    if (this.indexTimer) clearTimeout(this.indexTimer)
    this.indexTimer = null
    this.database?.close()
    this.database = null
    this.activeWorkspace = null
  }

  async recents(): Promise<RecentWorkspace[]> {
    try {
      const contents = await readFile(this.recentsPath(), 'utf8')
      return zRecentWorkspaces.parse(JSON.parse(contents))
    } catch {
      return []
    }
  }

  private loreRoot(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, 'lore')
  }

  private manuscriptRoot(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, 'manuscript')
  }

  private sceneVariantDirectory(sceneId: string): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    if (!/^[\w-]+$/u.test(sceneId)) throw new Error('Invalid scene version path.')
    return path.join(this.manuscriptRoot(), '_versions', sceneId)
  }

  private sceneVariantPath(sceneId: string, variantId: string): string {
    if (!/^[\w-]+$/u.test(variantId)) throw new Error('Invalid scene version.')
    return path.join(this.sceneVariantDirectory(sceneId), `${variantId}.md`)
  }

  private async ensureSceneVariants(scene: SceneDocument): Promise<SceneVariantManifest> {
    const directory = this.sceneVariantDirectory(scene.id)
    try {
      const parsed = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')) as SceneVariantManifest
      if (parsed.schemaVersion === 1 && typeof parsed.preferredId === 'string' && Array.isArray(parsed.variants)) return parsed
    } catch { /* Create the initial preferred version below. */ }
    const id = randomUUID()
    const now = new Date().toISOString()
    const manifest: SceneVariantManifest = { schemaVersion: 1, preferredId: id, variants: [{ id, name: 'Original', createdAt: now, updatedAt: now, wordCount: scene.metadata.wordCount }] }
    await mkdir(directory, { recursive: true })
    await writeAtomically(this.sceneVariantPath(scene.id, id), scene.content)
    await this.writeSceneVariantManifest(scene.id, manifest)
    return manifest
  }

  private async writeSceneVariantManifest(sceneId: string, manifest: SceneVariantManifest): Promise<void> {
    await mkdir(this.sceneVariantDirectory(sceneId), { recursive: true })
    await writeAtomically(path.join(this.sceneVariantDirectory(sceneId), 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  }

  private sceneSnapshotDirectory(sceneId: string): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    if (!/^[\w-]+$/u.test(sceneId)) throw new Error('Invalid scene snapshot path.')
    return path.join(this.activeWorkspace.path, '.worldvilla', 'snapshots', 'manuscript', sceneId)
  }

  private async snapshotScene(sceneId: string, content: string): Promise<void> {
    const directory = this.sceneSnapshotDirectory(sceneId)
    await mkdir(directory, { recursive: true })
    const id = new Date().toISOString().replace(/[.:]/g, '-')
    await writeAtomically(path.join(directory, `${id}.md`), content)
    const entries = await readdir(directory, { withFileTypes: true })
    const snapshots = (await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map(async (entry) => ({ entry, details: await stat(path.join(directory, entry.name)) })))).sort((left, right) => right.details.mtimeMs - left.details.mtimeMs)
    await Promise.all(snapshots.slice(25).map(({ entry }) => rm(path.join(directory, entry.name))))
  }

  private relationshipGraphPath(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, '.worldvilla', 'relationships.json')
  }

  private async readRelationshipGraph(): Promise<RelationshipGraph> {
    const fallback: RelationshipGraph = { schemaVersion: 1, relationships: [], customTypes: [], positions: {}, views: [] }
    try {
      return relationshipGraphFromValue(JSON.parse(await readFile(this.relationshipGraphPath(), 'utf8')))
    } catch { return fallback }
  }

  private async writeRelationshipGraph(graph: RelationshipGraph): Promise<void> {
    await writeAtomically(this.relationshipGraphPath(), `${JSON.stringify(graph, null, 2)}\n`)
  }

  private timelinePath(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, '.worldvilla', 'timeline.json')
  }

  private async readTimeline(): Promise<{ config: TimelineConfig; events: TimelineEvent[]; tracks: TimelineTrack[]; states: StateTransition[] }> {
    const fallback = { config: { schemaVersion: 1 as const, masterStartDate: '0001-01-01', masterEndDate: '1000-12-31' }, events: [] as TimelineEvent[], tracks: [] as TimelineTrack[], states: [] as StateTransition[] }
    try {
      const parsed = JSON.parse(await readFile(this.timelinePath(), 'utf8')) as { config?: TimelineConfig; events?: TimelineEvent[]; tracks?: TimelineTrack[]; states?: StateTransition[] }
      if (parsed.config?.schemaVersion === 1 && Array.isArray(parsed.events)) {
        const events = parsed.events.map((event) => ({ ...event, masterDate: event.masterDate.includes('T') ? event.masterDate : `${event.masterDate}T00:00`, storyTags: Array.isArray(event.storyTags) ? event.storyTags : [], placePaths: Array.isArray(event.placePaths) ? event.placePaths : [], characterPaths: Array.isArray(event.characterPaths) ? event.characterPaths : [] })).sort((left, right) => left.masterDate.localeCompare(right.masterDate))
        const tracks = Array.isArray(parsed.tracks) ? parsed.tracks.filter((track): track is TimelineTrack => typeof track?.name === 'string' && ['plot', 'character', 'place', 'faction', 'volume', 'custom'].includes(track.kind)) : []
        return { config: parsed.config, events, tracks: tracks.length ? tracks : [...new Set(events.flatMap((event) => event.tracks))].map((name) => ({ name, kind: 'custom' as const })), states: Array.isArray(parsed.states) ? parsed.states : [] }
      }
    } catch { /* Use a new timeline until its first save. */ }
    return fallback
  }

  private async eventTracks(event: TimelineEvent, existing: TimelineTrack[]): Promise<string[]> {
    const linked = await Promise.all([...event.characterPaths, ...event.placePaths, ...event.lorePaths].map(async (referencePath) => { try { const document = await this.readLoreDocument(referencePath); const kind = typeof document.frontmatter.type === 'string' && ['character', 'place', 'faction'].includes(document.frontmatter.type) ? document.frontmatter.type as TimelineTrackKind : null; return kind ? { name: document.title, kind, referencePath } : null } catch { return null } }))
    const known = new Map(existing.map((track) => [track.name, track]))
    return uniqueStrings([...event.tracks, ...linked.filter((track): track is { name: string; kind: TimelineTrackKind; referencePath: string } => track !== null).map((track) => { known.set(track.name, track); return track.name })])
  }

  private async mergeTimelineTracks(existing: TimelineTrack[], event: TimelineEvent): Promise<TimelineTrack[]> {
    const linked = await Promise.all([...event.characterPaths, ...event.placePaths, ...event.lorePaths].map(async (referencePath) => { try { const document = await this.readLoreDocument(referencePath); return typeof document.frontmatter.type === 'string' && ['character', 'place', 'faction'].includes(document.frontmatter.type) ? { name: document.title, kind: document.frontmatter.type as TimelineTrackKind, referencePath } : null } catch { return null } }))
    const byName = new Map(existing.map((track) => [track.name, track]))
    linked.filter((track): track is { name: string; kind: TimelineTrackKind; referencePath: string } => track !== null).forEach((track) => byName.set(track.name, track))
    event.tracks.forEach((name) => { if (!byName.has(name)) byName.set(name, { name, kind: 'custom' }) })
    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  private async writeTimeline(timeline: { config: TimelineConfig; events: TimelineEvent[]; tracks: TimelineTrack[]; states: StateTransition[] }): Promise<void> {
    await writeAtomically(this.timelinePath(), `${JSON.stringify({ ...timeline, events: [...timeline.events].sort((left, right) => left.masterDate.localeCompare(right.masterDate)) }, null, 2)}\n`)
  }

  private manuscriptOrderPath(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, '.worldvilla', 'manuscript-order.json')
  }

  private corkboardLayoutPath(): string {
    if (!this.activeWorkspace) throw new Error('No workspace is open.')
    return path.join(this.activeWorkspace.path, '.worldvilla', 'corkboard.json')
  }

  private async readManuscriptOrder(): Promise<ManuscriptOrder> {
    try {
      const raw = JSON.parse(await readFile(this.manuscriptOrderPath(), 'utf8')) as { order?: unknown }
      if (!raw.order || typeof raw.order !== 'object' || Array.isArray(raw.order)) return {}
      return Object.fromEntries(Object.entries(raw.order).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((path) => typeof path === 'string')))
    } catch { return {} }
  }

  private manuscriptPath(relativePath: string, requireMarkdown: boolean): string {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if ((normalized && normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) || (requireMarkdown && !normalized)) throw new Error('Invalid manuscript path.')
    if (requireMarkdown && !normalized.endsWith('.md')) throw new Error('Scenes must be Markdown files.')
    const fullPath = path.resolve(this.manuscriptRoot(), normalized)
    if (!isWithin(this.manuscriptRoot(), fullPath)) throw new Error('Invalid manuscript path.')
    return fullPath
  }

  private manuscriptRelativePath(fullPath: string): string {
    return path.relative(this.manuscriptRoot(), fullPath).split(path.sep).join('/')
  }

  private lorePath(relativePath: string, requireMarkdown: boolean): string {
    const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
    if ((normalized && normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) || (requireMarkdown && !normalized)) {
      throw new Error('Invalid workspace path.')
    }
    if (requireMarkdown && !normalized.endsWith('.md')) throw new Error('Lore documents must be Markdown files.')
    const fullPath = path.resolve(this.loreRoot(), normalized)
    if (!isWithin(this.loreRoot(), fullPath)) throw new Error('Invalid workspace path.')
    return fullPath
  }

  private loreRelativePath(fullPath: string): string {
    return path.relative(this.loreRoot(), fullPath).split(path.sep).join('/')
  }

  private async moveLorePath(source: string, target: string): Promise<void> {
    if (!isWithin(this.loreRoot(), target)) throw new Error('Invalid folder location.')
    if (source === target) return
    try {
      await access(target)
      throw new Error('An item with that name already exists in the destination folder.')
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
    }
    await rename(source, target)
  }

  private async rewriteWikiPaths(oldPath: string, newPath: string): Promise<void> {
    const documents = await findLoreDocuments(this.loreRoot())
    await Promise.all(documents.map(async (fullPath) => {
      const raw = await readFile(fullPath, 'utf8')
      const rewritten = replaceWikiPathPrefix(raw, oldPath, newPath)
      if (rewritten !== raw) await writeAtomically(fullPath, rewritten)
    }))
  }

  private async activate(workspace: WorkspaceSummary): Promise<void> {
    await this.watcher?.close()
    this.database?.close()
    await mkdir(path.join(workspace.path, '.worldvilla'), { recursive: true })
    this.activeWorkspace = workspace
    this.database = new Database(path.join(workspace.path, '.worldvilla', 'index.sqlite'))
    this.initializeSearchIndex()
    await this.rebuildSearchIndex()
    this.watcher = chokidar.watch(workspace.path, {
      ignoreInitial: true,
      ignored: ['**/.worldvilla/**', '**/node_modules/**'],
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 }
    })

    this.watcher.on('add', (filePath) => { this.reportChange('added', filePath); this.scheduleSearchIndexRebuild(filePath) })
    this.watcher.on('change', (filePath) => { this.reportChange('changed', filePath); this.scheduleSearchIndexRebuild(filePath) })
    this.watcher.on('unlink', (filePath) => { this.reportChange('deleted', filePath); this.scheduleSearchIndexRebuild(filePath) })
  }

  private initializeSearchIndex(): void {
    this.database?.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        path TEXT PRIMARY KEY, id TEXT NOT NULL, title TEXT NOT NULL, type TEXT NOT NULL,
        tags TEXT NOT NULL, content TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS lore_fts USING fts5(path UNINDEXED, title, content);
    `)
  }

  private async rebuildSearchIndex(): Promise<void> {
    if (!this.database) return
    const documentPaths = await findLoreDocuments(this.loreRoot())
    const documents = await Promise.all(documentPaths.map(async (fullPath) => {
      const raw = await readFile(fullPath, 'utf8')
      const parsed = matter(raw)
      const title = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : path.basename(fullPath, '.md').replaceAll('-', ' ')
      const type = validEntityTypeOrNote(parsed.data.type)
      const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.toLocaleLowerCase()) : []
      return { path: this.loreRelativePath(fullPath), id: typeof parsed.data.id === 'string' ? parsed.data.id : '', title, type, tags: JSON.stringify(tags), content: parsed.content }
    }))
    const rebuild = this.database.transaction((entries: typeof documents) => {
      this.database?.exec('DELETE FROM documents; DELETE FROM lore_fts;')
      const insertDocument = this.database?.prepare('INSERT INTO documents (path, id, title, type, tags, content) VALUES (@path, @id, @title, @type, @tags, @content)')
      const insertSearch = this.database?.prepare('INSERT INTO lore_fts (path, title, content) VALUES (@path, @title, @content)')
      for (const document of entries) {
        insertDocument?.run(document)
        insertSearch?.run(document)
      }
    })
    rebuild(documents)
  }

  private scheduleSearchIndexRebuild(filePath: string): void {
    if (!filePath.endsWith('.md') || !filePath.startsWith(this.loreRoot())) return
    if (this.indexTimer) clearTimeout(this.indexTimer)
    this.indexTimer = setTimeout(() => { void this.rebuildSearchIndex() }, 300)
  }

  private reportChange(type: WorkspaceChange['type'], filePath: string): void {
    if (!this.activeWorkspace) return
    const relativePath = path.relative(this.activeWorkspace.path, filePath)
    if (!relativePath || relativePath.startsWith('..')) return
    this.onChange({ type, path: relativePath.split(path.sep).join('/'), occurredAt: new Date().toISOString() })
  }

  private async remember(workspace: WorkspaceSummary): Promise<void> {
    const previous = await this.recents()
    const entry: RecentWorkspace = {
      id: workspace.id,
      name: workspace.name,
      path: workspace.path,
      lastOpenedAt: new Date().toISOString()
    }
    const recents = [entry, ...previous.filter((recent) => recent.path !== workspace.path)].slice(0, 12)
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.recentsPath(), `${JSON.stringify(recents, null, 2)}\n`, 'utf8')
  }
}

async function countFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true })
  const counts = await Promise.all(entries.map(async (entry) => {
    if (entry.name === '.worldvilla' || entry.name === 'node_modules') return 0
    if (!entry.isDirectory()) return 1
    return countFiles(path.join(directory, entry.name))
  }))
  return counts.reduce((total, count) => total + count, 0)
}

async function findLoreDocuments(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return findLoreDocuments(fullPath)
    return entry.name.endsWith('.md') ? [fullPath] : []
  }))
  return paths.flat()
}

async function findManuscriptScenes(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const paths = await Promise.all(entries.filter((entry) => entry.name !== '_versions').map(async (entry) => {
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? findManuscriptScenes(fullPath) : entry.name.endsWith('.md') ? [fullPath] : []
  }))
  return paths.flat()
}

async function readManuscriptTree(directory: string, relativeDirectory: string, order: ManuscriptOrder): Promise<ManuscriptNode[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const depth = relativeDirectory ? relativeDirectory.split('/').length : 0
  const folderKinds: Array<Exclude<import('../shared/workspace').ManuscriptNodeKind, 'scene'>> = ['volume', 'part', 'chapter']
  const nodes = await Promise.all(entries.filter((entry) => (entry.isDirectory() || entry.name.endsWith('.md')) && entry.name !== '_versions').map(async (entry): Promise<ManuscriptNode> => {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return { id: relativePath, title: titleFromSegment(entry.name), path: relativePath, kind: folderKinds[depth] ?? 'chapter', children: await readManuscriptTree(fullPath, relativePath, order) }
    const scene = await sceneFromFile(fullPath, relativePath)
    return { id: scene.id, title: scene.title, path: scene.path, kind: 'scene', metadata: scene.metadata }
  }))
  const positions = new Map((order[relativeDirectory] ?? []).map((entry, index) => [entry, index]))
  return nodes.sort((left, right) => (positions.get(left.path) ?? Number.MAX_SAFE_INTEGER) - (positions.get(right.path) ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title))
}

async function sceneFromFile(fullPath: string, relativePath: string): Promise<SceneDocument> {
  return sceneFromContent(await readFile(fullPath, 'utf8'), relativePath, titleFromSegment(path.basename(fullPath, '.md')))
}

function sceneFromContent(content: string, relativePath: string, fallbackTitle: string): SceneDocument {
  const parsed = matter(content)
  const title = typeof parsed.data.title === 'string' && parsed.data.title.trim() ? parsed.data.title.trim() : fallbackTitle
  const metadata: SceneMetadata = {
    pov: typeof parsed.data.pov === 'string' ? parsed.data.pov : '',
    inWorldDate: typeof parsed.data.inWorldDate === 'string' ? parsed.data.inWorldDate : '',
    locations: stringArray(parsed.data.locations),
    characters: stringArray(parsed.data.characters),
    status: validSceneStatus(parsed.data.status),
    tags: stringArray(parsed.data.tags),
    wordCount: countWords(parsed.content)
  }
  return { id: typeof parsed.data.id === 'string' ? parsed.data.id : '', path: relativePath, title, content, metadata }
}

async function metadataRenameReference(fullPath: string, source: 'lore' | 'manuscript', relativePath: string, oldTitle: string): Promise<RenameMetadataReference | null> {
  const parsed = matter(await readFile(fullPath, 'utf8'))
  const fields = metadataFieldsMatching(parsed.data, oldTitle)
  if (!fields.length) return null
  const fallback = path.basename(fullPath, '.md')
  return { source, path: relativePath, title: typeof parsed.data.title === 'string' ? parsed.data.title : fallback, fields }
}

function assertMasterDateTime(value: string): void {
  if (!/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(value)) throw new Error('Event times use Gregorian format YYYY-MM-DDTHH:mm.')
  assertMasterDate(value.slice(0, 10))
  const [, time] = value.split('T')
  const [hours, minutes] = time.split(':').map(Number)
  if (hours > 23 || minutes > 59) throw new Error('Event time is invalid.')
}

function validateEventInterval(start: string, end: string | undefined, config: TimelineConfig): void {
  assertMasterDateTime(start)
  assertDateWithinMasterSpan(start, config)
  if (!end) return
  assertMasterDateTime(end)
  assertDateWithinMasterSpan(end, config)
  if (end < start) throw new Error('An event end time cannot be before its start time.')
}

function assertDateWithinMasterSpan(value: string, config: TimelineConfig): void {
  const date = value.slice(0, 10)
  if (date < config.masterStartDate || date > config.masterEndDate) throw new Error(`Event time must fall within ${config.masterStartDate} through ${config.masterEndDate}.`)
}

function assertMasterDate(value: string): void {
  if (!/^\d{4,}-\d{2}-\d{2}$/u.test(value)) throw new Error('Master dates use Gregorian format YYYY-MM-DD.')
  const [, month, day] = value.split('-').map(Number)
  if (month < 1 || month > 12 || day < 1 || day > 31) throw new Error('Master date is invalid.')
}

function relationshipGraphFromValue(value: unknown): RelationshipGraph {
  if (!value || typeof value !== 'object' || (value as { schemaVersion?: unknown }).schemaVersion !== 1) throw new Error('This is not a WorldVilla relationship export.')
  const parsed = value as Partial<RelationshipGraph>
  if (!Array.isArray(parsed.relationships)) throw new Error('Relationship export is missing relationship records.')
  const kinds: RelationshipKind[] = ['parent', 'sibling', 'spouse', 'custom', 'partner', 'adoption', 'guardian', 'rivalry', 'allegiance', 'membership', 'ownership', 'succession']
  const relationships = parsed.relationships.filter((relationship): relationship is Relationship => typeof relationship?.id === 'string' && typeof relationship.fromPath === 'string' && typeof relationship.toPath === 'string' && typeof relationship.kind === 'string' && kinds.includes(relationship.kind as RelationshipKind)).map((relationship) => ({ ...relationship, label: typeof relationship.label === 'string' ? relationship.label : '', parentRole: relationship.parentRole === 'maternal' || relationship.parentRole === 'paternal' ? relationship.parentRole : undefined, notes: typeof relationship.notes === 'string' ? relationship.notes : '', createdAt: typeof relationship.createdAt === 'string' ? relationship.createdAt : new Date().toISOString() }))
  const positions = Object.fromEntries(Object.entries(parsed.positions ?? {}).filter(([, position]) => Boolean(position) && Number.isFinite(position.x) && Number.isFinite(position.y)))
  return { schemaVersion: 1, relationships, customTypes: Array.isArray(parsed.customTypes) ? parsed.customTypes.filter((type): type is RelationshipType => typeof type?.id === 'string' && typeof type.name === 'string') : [], positions, views: Array.isArray(parsed.views) ? parsed.views.filter((view) => typeof view?.id === 'string' && typeof view.name === 'string' && Array.isArray(view.types)) : [] }
}

function uniqueStrings(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))]
}

function searchRank(result: GlobalSearchResult, terms: string[]): number {
  const title = result.title.toLocaleLowerCase()
  const path = result.path.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (title === term ? 100 : title.startsWith(term) ? 40 : title.includes(term) ? 20 : 0) + (path.includes(term) ? 5 : 0) + (result.tags.some((tag) => tag.toLocaleLowerCase() === term) ? 10 : 0), 0)
}

function metadataFieldsMatching(data: Record<string, unknown>, title: string): string[] {
  const target = title.trim().toLocaleLowerCase()
  return ['pov', 'locations', 'characters', 'tags'].filter((field) => {
    const value = data[field]
    return typeof value === 'string' ? value.trim().toLocaleLowerCase() === target : Array.isArray(value) && value.some((entry) => typeof entry === 'string' && entry.trim().toLocaleLowerCase() === target)
  })
}

function renameMetadataValues(data: Record<string, unknown>, oldTitle: string, newTitle: string): Record<string, unknown> {
  const fields = metadataFieldsMatching(data, oldTitle)
  if (!fields.length) return data
  const target = oldTitle.trim().toLocaleLowerCase()
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, fields.includes(key) ? (typeof value === 'string' ? newTitle : (value as unknown[]).map((entry) => typeof entry === 'string' && entry.trim().toLocaleLowerCase() === target ? newTitle : entry)) : value]))
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function validSceneStatus(value: unknown): SceneStatus {
  return typeof value === 'string' && ['idea', 'draft', 'revised', 'complete'].includes(value) ? value as SceneStatus : 'idea'
}

async function manuscriptDocx(markdown: string): Promise<Buffer> {
  const children = markdown.split(/\n{2,}/u).flatMap((block) => {
    const heading = block.match(/^# (.+)$/u)
    if (heading) return [new Paragraph({ children: [new TextRun({ text: heading[1], bold: true, size: 32 })], spacing: { before: 300, after: 160 } })]
    return block.split('\n').map((line) => new Paragraph({ children: [new TextRun(line)] }))
  })
  return Packer.toBuffer(new Document({ sections: [{ children }] }))
}

function manuscriptHtml(markdown: string): string {
  const body = markdown.split(/\n{2,}/u).map((block) => {
    const heading = block.match(/^# (.+)$/u)
    if (heading) return `<h1>${escapeHtml(heading[1])}</h1>`
    return `<p>${escapeHtml(block).replaceAll('\n', '<br>')}</p>`
  }).join('\n')
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>Manuscript export</title></head><body>\n${body}\n</body></html>\n`
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function countWords(content: string): number {
  return matter(content).content.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)?/gu)?.length ?? 0
}

function titleFromSegment(segment: string): string {
  return segment.replaceAll('-', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

async function readLoreTree(directory: string, relativeDirectory: string): Promise<LoreTreeNode[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nodes = await Promise.all(entries
    .filter((entry) => entry.isDirectory() || entry.name.endsWith('.md'))
    .map(async (entry): Promise<LoreTreeNode | null> => {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      const fullPath = path.join(directory, entry.name)
      if (!entry.isDirectory()) {
        const content = matter(await readFile(fullPath, 'utf8'))
        const fallbackName = entry.name.slice(0, -3).replaceAll('-', ' ')
        return { name: typeof content.data.title === 'string' && content.data.title.trim() ? content.data.title.trim() : fallbackName, path: relativePath, kind: 'file' }
      }
      return { name: entry.name, path: relativePath, kind: 'folder', children: await readLoreTree(path.join(directory, entry.name), relativePath) }
    }))
  return nodes.filter((node): node is LoreTreeNode => node !== null).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

function replaceWikiPathPrefix(content: string, oldPath: string, newPath: string): string {
  const normalizedOld = oldPath.replace(/\\/g, '/').replace(/\.md$/, '').toLocaleLowerCase()
  const normalizedNew = newPath.replace(/\\/g, '/').replace(/\.md$/, '')
  return content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (source, target: string, alias = '') => {
    const normalizedTarget = target.trim().replace(/\\/g, '/').replace(/\.md$/, '').toLocaleLowerCase()
    if (normalizedTarget !== normalizedOld && !normalizedTarget.startsWith(`${normalizedOld}/`)) return source
    return `[[${normalizedNew}${target.trim().slice(normalizedOld.length)}${alias}]]`
  })
}

function replaceWikiTargets(content: string, oldTitle: string, oldPath: string, newTitle: string): string {
  const normalizedTitle = oldTitle.trim().toLocaleLowerCase()
  const normalizedPath = oldPath.toLocaleLowerCase()
  return content.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (source, target: string, alias = '') => {
    const normalizedTarget = target.trim().toLocaleLowerCase()
    return normalizedTarget === normalizedTitle || normalizedTarget === normalizedPath ? `[[${newTitle}${alias}]]` : source
  })
}

function containsWikiReference(content: string, target: LoreReference): boolean {
  const normalizedTitle = target.title.trim().toLocaleLowerCase()
  const normalizedPath = target.path.replace(/\.md$/, '').toLocaleLowerCase()
  return [...content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].some((match) => {
    const reference = match[1].trim().toLocaleLowerCase()
    return reference === normalizedTitle || reference === normalizedPath
  })
}

function safeSegment(name: string): string {
  const segment = name.trim().replace(/\.md$/i, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
  if (!segment) throw new Error('Name must include at least one letter or number.')
  return segment
}

function validEntityType(type: LoreEntityType): LoreEntityType {
  const normalized = type.trim().toLocaleLowerCase()
  if (/^[a-z][a-z0-9-]{0,31}$/u.test(normalized)) return normalized
  throw new Error('Lore types use lowercase letters, numbers, and hyphens.')
}

function validEntityTypeOrNote(value: unknown): LoreEntityType {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/u.test(value.trim().toLocaleLowerCase()) ? value.trim().toLocaleLowerCase() : 'note'
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

async function writeAtomically(fullPath: string, content: string): Promise<void> {
  const temporaryPath = `${fullPath}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, content, 'utf8')
  await rename(temporaryPath, fullPath)
}

const zRecentWorkspaces = z.array(z.object({
  id: z.string().uuid(),
  name: z.string(),
  path: z.string(),
  lastOpenedAt: z.string().datetime()
}))
