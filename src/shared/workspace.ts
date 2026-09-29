import { z } from 'zod'

export const workspaceManifestSchema = z.object({
  formatVersion: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
})

export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>

export type WorkspaceSummary = WorkspaceManifest & {
  path: string
}

export type RecentWorkspace = Pick<WorkspaceSummary, 'id' | 'name' | 'path'> & {
  lastOpenedAt: string
}

export type WorkspaceChange = {
  type: 'added' | 'changed' | 'deleted'
  path: string
  occurredAt: string
}

export type WorkspaceRescan = {
  completedAt: string
  fileCount: number
}

export type BuiltInLoreEntityType = 'character' | 'place' | 'faction' | 'item' | 'event' | 'note'
/** A built-in type or an author-defined lowercase type such as `spell` or `creature`. */
export type LoreEntityType = BuiltInLoreEntityType | (string & {})

export type LoreTreeNode = {
  name: string
  path: string
  kind: 'folder' | 'file'
  children?: LoreTreeNode[]
}

export type LoreDocument = {
  path: string
  title: string
  content: string
  frontmatter: Record<string, unknown>
}

export type LoreReference = {
  path: string
  title: string
  type?: LoreEntityType
}

export type CreateLoreDocument = {
  parentPath: string
  name: string
  type: LoreEntityType
}

export type LorePropertyPatch = {
  title?: string
  type?: LoreEntityType
  tags?: string[]
}

export type RenameMetadataReference = {
  source: 'lore' | 'manuscript'
  path: string
  title: string
  fields: string[]
}

export type LoreRenamePreview = {
  oldTitle: string
  newTitle: string
  affectedReferences: LoreReference[]
  affectedMetadata: RenameMetadataReference[]
}

export type LoreSearchFilters = {
  type?: LoreEntityType
  tag?: string
  folder?: string
}

export type LoreSearchResult = LoreReference & {
  type: LoreEntityType
  tags: string[]
  excerpt: string
}

export type GlobalSearchResult = {
  source: 'lore' | 'manuscript'
  path: string
  title: string
  type: string
  tags: string[]
  excerpt: string
}

export type ManuscriptNodeKind = 'volume' | 'part' | 'chapter' | 'scene'
export type SceneStatus = 'idea' | 'draft' | 'revised' | 'complete'

export type SceneMetadata = {
  pov: string
  inWorldDate: string
  locations: string[]
  characters: string[]
  status: SceneStatus
  tags: string[]
  wordCount: number
}

export type ManuscriptNode = {
  id: string
  title: string
  path: string
  kind: ManuscriptNodeKind
  children?: ManuscriptNode[]
  metadata?: SceneMetadata
}

export type SceneDocument = {
  id: string
  path: string
  title: string
  content: string
  metadata: SceneMetadata
}

export type CreateManuscriptContainer = {
  parentPath: string
  title: string
  kind: Exclude<ManuscriptNodeKind, 'scene'>
}

export type ManuscriptExportFormat = 'markdown' | 'html' | 'docx'

export type ManuscriptExportResult = {
  canceled: boolean
  path?: string
  sceneCount: number
}

export type CreateScene = {
  parentPath: string
  title: string
  pov?: string
  status?: SceneStatus
}

export type SceneMetadataPatch = Partial<Pick<SceneMetadata, 'pov' | 'inWorldDate' | 'locations' | 'characters' | 'status' | 'tags'>>

export type ManuscriptOrder = Record<string, string[]>

export type CorkboardLayout = {
  schemaVersion: 1
  cardOrder: string[]
}

export type SceneSnapshot = {
  id: string
  createdAt: string
  wordCount: number
}

export type InWorldCalendar = {
  id: string
  name: string
  eraLabel: string
  months: Array<{ name: string; days: number }>
  epochMasterDate: string
}

export type TimelineConfig = {
  schemaVersion: 1
  masterStartDate: string
  masterEndDate: string
  calendars?: InWorldCalendar[]
}

export type TimelineTrackKind = 'plot' | 'character' | 'place' | 'faction' | 'volume' | 'custom'
export type TimelineTrack = {
  name: string
  kind: TimelineTrackKind
  referencePath?: string
}

export type TimelineEvent = {
  id: string
  title: string
  /** Gregorian-style local date and time: YYYY-MM-DDTHH:mm. */
  masterDate: string
  /** Optional end of an interval; omitted for an instantaneous event. */
  masterEndDate?: string
  inWorldDate?: string
  tracks: string[]
  storyTags: string[]
  /** Required setting(s), restricted to Place lore entries. */
  placePaths: string[]
  /** Optional participating Character lore entries. */
  characterPaths: string[]
  scenePaths: string[]
  lorePaths: string[]
  notes: string
  createdAt: string
  updatedAt: string
}

export type CreateTimelineEvent = Pick<TimelineEvent, 'title' | 'masterDate' | 'placePaths'> & Partial<Pick<TimelineEvent, 'masterEndDate' | 'inWorldDate' | 'tracks' | 'storyTags' | 'characterPaths' | 'scenePaths' | 'lorePaths' | 'notes'>>
export type TimelineEventPatch = Partial<Omit<CreateTimelineEvent, 'title' | 'masterDate'>> & Partial<Pick<TimelineEvent, 'title' | 'masterDate'>>

export type StateField = 'holder' | 'location' | 'lifeStatus' | 'allegiance'
export type StateTransition = {
  id: string
  subjectPath: string
  field: StateField
  from?: string
  to: string
  effectiveDate: string
  eventId?: string
  notes: string
  createdAt: string
}
export type CreateStateTransition = Omit<StateTransition, 'id' | 'createdAt'>
export type ContinuityWarning = { transitionIds: string[]; message: string }

export type RelationshipKind = 'parent' | 'sibling' | 'spouse' | 'custom' | 'partner' | 'adoption' | 'guardian' | 'rivalry' | 'allegiance' | 'membership' | 'ownership' | 'succession'

export type Relationship = {
  id: string
  fromPath: string
  toPath: string
  kind: RelationshipKind
  parentRole?: 'maternal' | 'paternal'
  /** Reusable author-defined relationship type when kind is `custom`. */
  customTypeId?: string
  label: string
  notes: string
  createdAt: string
}

export type CreateRelationship = Pick<Relationship, 'fromPath' | 'toPath' | 'kind'> & Partial<Pick<Relationship, 'parentRole' | 'customTypeId' | 'label' | 'notes'>>
export type RelationshipPatch = CreateRelationship

export type RelationshipType = { id: string; name: string }
export type CreateRelationshipType = Pick<RelationshipType, 'name'>

export type RelationshipGraphPosition = { x: number; y: number }
export type RelationshipGraphView = {
  id: string
  name: string
  focusPath?: string
  types: LoreEntityType[]
}
export type RelationshipGraph = {
  schemaVersion: 1
  relationships: Relationship[]
  customTypes: RelationshipType[]
  positions: Record<string, RelationshipGraphPosition>
  views: RelationshipGraphView[]
}

export type SceneVariant = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  wordCount: number
  preferred: boolean
}

export type CreateSceneVariant = {
  name: string
  sourceVariantId?: string
}
