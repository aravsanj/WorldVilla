import { useEffect, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { autocompletion, type CompletionContext } from '@codemirror/autocomplete'
import { EditorView } from '@codemirror/view'
import ReactMarkdown from 'react-markdown'
import type { CorkboardLayout, CreateLoreDocument, GlobalSearchResult, LoreDocument, LoreEntityType, LoreReference, LoreTreeNode, ManuscriptNode, RecentWorkspace, Relationship, RelationshipGraph, RelationshipKind, SceneDocument, SceneMetadataPatch, SceneVariant, StateTransition, TimelineConfig, TimelineEvent, TimelineTrack, WorkspaceChange, WorkspaceRescan, WorkspaceSummary } from '../../shared/workspace'

type CreateMode = 'document' | 'folder'

export default function App(): React.JSX.Element {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [section, setSection] = useState<'library' | 'manuscript' | 'timeline' | 'relationships'>('library')
  const [recents, setRecents] = useState<RecentWorkspace[]>([])
  const [tree, setTree] = useState<LoreTreeNode[]>([])
  const [references, setReferences] = useState<LoreReference[]>([])
  const [backlinks, setBacklinks] = useState<LoreReference[]>([])
  const [document, setDocument] = useState<LoreDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [selectedFolder, setSelectedFolder] = useState('')
  const [newWorldName, setNewWorldName] = useState('')
  const [createName, setCreateName] = useState('')
  const [createType, setCreateType] = useState<LoreEntityType>('note')
  const [createMode, setCreateMode] = useState<CreateMode>('document')
  const [viewMode, setViewMode] = useState<'read' | 'edit'>('read')
  const [error, setError] = useState<string | null>(null)
  const [isWorking, setIsWorking] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [lastChange, setLastChange] = useState<WorkspaceChange | null>(null)
  const [lastRescan, setLastRescan] = useState<WorkspaceRescan | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<GlobalSearchResult[]>([])
  const [requestedScenePath, setRequestedScenePath] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ node: LoreTreeNode; x: number; y: number } | null>(null)

  const refreshRecents = async (): Promise<void> => setRecents(await window.worldvilla.workspace.listRecents())
  const refreshLibrary = async (): Promise<void> => {
    const [nodes, entries] = await Promise.all([window.worldvilla.lore.list(), window.worldvilla.lore.listReferences()])
    setTree(nodes)
    setReferences(entries)
  }

  useEffect(() => {
    void window.worldvilla.workspace.listRecents().then(setRecents)
    return window.worldvilla.workspace.onChanged((change) => {
      setLastChange(change)
      if (change.path === 'lore' || change.path.startsWith('lore/')) void refreshLibrary()
    })
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const close = (): void => setContextMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [contextMenu])

  useEffect(() => {
    if (!workspace || !searchQuery.trim()) return
    const timeout = window.setTimeout(() => {
      void window.worldvilla.workspace.search(searchQuery).then(setSearchResults).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to search workspace.'))
    }, 120)
    return () => window.clearTimeout(timeout)
  }, [workspace, searchQuery])

  useEffect(() => {
    if (!document || !isDirty) return
    const timeout = window.setTimeout(() => {
      void window.worldvilla.lore.save(document.path, draft).then(async (saved) => {
        setDocument(saved)
        setDraft(saved.content)
        setIsDirty(false)
        const incoming = await window.worldvilla.lore.listBacklinks(saved.path)
        setBacklinks(incoming)
        await refreshLibrary()
      }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to save document.'))
    }, 800)
    return () => window.clearTimeout(timeout)
  }, [document, draft, isDirty])

  const openWorkspace = async (action: () => Promise<WorkspaceSummary | null>): Promise<void> => {
    setError(null)
    setIsWorking(true)
    try {
      const selected = await action()
      if (selected) {
        setWorkspace(selected)
        setDocument(null)
        setBacklinks([])
        setDraft('')
        setSelectedFolder('')
        await Promise.all([refreshRecents(), refreshLibrary()])
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open workspace.')
    } finally {
      setIsWorking(false)
    }
  }

  const openDocument = async (documentPath: string): Promise<void> => {
    setContextMenu(null)
    setSelectedFolder('')
    setError(null)
    try {
      const [opened, incoming] = await Promise.all([window.worldvilla.lore.read(documentPath), window.worldvilla.lore.listBacklinks(documentPath)])
      setDocument(opened)
      setBacklinks(incoming)
      setDraft(opened.content)
      setIsDirty(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open document.')
    }
  }

  const createEntry = async (): Promise<void> => {
    if (!createName.trim()) return
    setError(null)
    setIsWorking(true)
    try {
      if (createMode === 'folder') {
        await window.worldvilla.lore.createFolder(selectedFolder, createName)
        await refreshLibrary()
      } else {
        const input: CreateLoreDocument = { parentPath: selectedFolder, name: createName, type: createType }
        const created = await window.worldvilla.lore.createDocument(input)
        await refreshLibrary()
        setDocument(created)
        setDraft(created.content)
        setIsDirty(false)
      }
      setCreateName('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create entry.')
    } finally {
      setIsWorking(false)
    }
  }

  const deleteDocument = async (documentPath = document?.path ?? '', title = document?.title ?? documentPath): Promise<void> => {
    if (!documentPath || !window.confirm(`Delete “${title}”? This permanently removes its Markdown file.`)) return
    setError(null)
    setIsWorking(true)
    try {
      await window.worldvilla.lore.delete(documentPath)
      if (document?.path === documentPath) {
        setDocument(null)
        setDraft('')
        setBacklinks([])
        setIsDirty(false)
      }
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete document.')
    } finally {
      setIsWorking(false)
    }
  }

  const relocateOpenDocument = async (fromFolder: string, toFolder: string): Promise<void> => {
    if (!document || !document.path.startsWith(`${fromFolder}/`)) return
    const movedPath = `${toFolder}${document.path.slice(fromFolder.length)}`
    const [opened, incoming] = await Promise.all([window.worldvilla.lore.read(movedPath), window.worldvilla.lore.listBacklinks(movedPath)])
    setDocument(opened)
    setDraft(opened.content)
    setBacklinks(incoming)
    setIsDirty(false)
  }

  const moveNode = async (node: LoreTreeNode, destinationFolder: string): Promise<void> => {
    if (node.kind === 'folder' && (node.path === destinationFolder || destinationFolder.startsWith(`${node.path}/`))) return
    setError(null)
    setIsWorking(true)
    try {
      if (node.kind === 'file') {
        if (document?.path === node.path && isDirty) await window.worldvilla.lore.save(document.path, draft)
        const moved = await window.worldvilla.lore.move(node.path, destinationFolder)
        if (document?.path === node.path) {
          const incoming = await window.worldvilla.lore.listBacklinks(moved.path)
          setDocument(moved)
          setDraft(moved.content)
          setBacklinks(incoming)
          setIsDirty(false)
        }
      } else {
        const moved = await window.worldvilla.lore.moveFolder(node.path, destinationFolder)
        await relocateOpenDocument(node.path, moved)
        if (selectedFolder === node.path) setSelectedFolder(moved)
      }
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to move item.')
    } finally {
      setIsWorking(false)
    }
  }

  const renameFolder = async (folderPath = selectedFolder): Promise<void> => {
    if (!folderPath) return
    const currentName = folderPath.split('/').at(-1) ?? folderPath
    const name = window.prompt('Folder name', currentName)
    if (name === null || !name.trim() || name.trim() === currentName) return
    setError(null)
    setIsWorking(true)
    try {
      const renamed = await window.worldvilla.lore.renameFolder(folderPath, name)
      await relocateOpenDocument(folderPath, renamed)
      if (selectedFolder === folderPath) setSelectedFolder(renamed)
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rename folder.')
    } finally {
      setIsWorking(false)
    }
  }

  const deleteFolder = async (folderPath = selectedFolder): Promise<void> => {
    if (!folderPath || !window.confirm(`Delete “${folderPath}” and every lore entry inside it? This cannot be undone.`)) return
    setError(null)
    setIsWorking(true)
    try {
      await window.worldvilla.lore.deleteFolder(folderPath)
      if (document?.path.startsWith(`${folderPath}/`)) {
        setDocument(null)
        setDraft('')
        setBacklinks([])
      }
      if (selectedFolder === folderPath) setSelectedFolder('')
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete folder.')
    } finally {
      setIsWorking(false)
    }
  }

  const updateProperties = async (patch: { title?: string; type?: LoreEntityType; tags?: string[] }): Promise<void> => {
    if (!document) return
    setError(null)
    setIsWorking(true)
    try {
      if (patch.title && patch.title.trim() !== document.title) {
        const preview = await window.worldvilla.lore.previewRename(document.path, patch.title)
        const references = preview.affectedReferences.length ? `\n\nWiki references to update (${preview.affectedReferences.length}):\n${preview.affectedReferences.map((reference) => `• ${reference.title}`).join('\n')}` : '\n\nNo wiki references need updating.'
        const metadata = preview.affectedMetadata.length ? `\n\nMetadata values to update (${preview.affectedMetadata.length}):\n${preview.affectedMetadata.map((entry) => `• ${entry.title}: ${entry.fields.join(', ')}`).join('\n')}` : ''
        if (!window.confirm(`Rename “${preview.oldTitle}” to “${preview.newTitle}”?${references}${metadata}`)) return
      }
      const saved = await window.worldvilla.lore.updateProperties(document.path, patch, draft)
      const incoming = await window.worldvilla.lore.listBacklinks(saved.path)
      setDocument(saved)
      setDraft(saved.content)
      setBacklinks(incoming)
      setIsDirty(false)
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update properties.')
    } finally {
      setIsWorking(false)
    }
  }

  const rescan = async (): Promise<void> => {
    setError(null)
    setIsWorking(true)
    try {
      setLastRescan(await window.worldvilla.workspace.rescan())
      await refreshLibrary()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to rescan workspace.')
    } finally {
      setIsWorking(false)
    }
  }

  if (!workspace) return <Welcome newWorldName={newWorldName} setNewWorldName={setNewWorldName} recents={recents} isWorking={isWorking} error={error} openWorkspace={openWorkspace} />

  return (
    <main className="library-shell">
      <aside className="library-sidebar">
        <p className="eyebrow">OPEN WORLD</p>
        <h1>{workspace.name}</h1>
        <p className="path">{workspace.path}</p>
        <nav aria-label="Workspace sections">
          <button className={section === 'library' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('library')}>Library</button>
          <button className={section === 'manuscript' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('manuscript')}>Manuscript</button>
          <button className={section === 'timeline' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('timeline')}>Timeline</button>
          <button className={section === 'relationships' ? 'nav-item active' : 'nav-item'} onClick={() => setSection('relationships')}>Relationships</button>
          <button className="nav-item" disabled>Maps <span>Coming soon</span></button>
        </nav>
        <label className="global-search"><span className="sr-only">Global search</span><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setSearchQuery('') }} placeholder="Global search" /></label>
        <div className="sidebar-actions"><button className="sidebar-link" disabled={isWorking} onClick={() => void rescan()}>Rescan workspace</button><button className="sidebar-link" onClick={() => setWorkspace(null)}>Open another world</button></div>
      </aside>
      {searchQuery.trim() && <div className="global-search-overlay"><SearchResults query={searchQuery} results={searchResults} onOpen={(result) => { setSearchQuery(''); if (result.source === 'lore') { setSection('library'); void openDocument(result.path) } else { setRequestedScenePath(result.path); setSection('manuscript') } }} /></div>}
      {section === 'manuscript' ? <ManuscriptPanel requestedScenePath={requestedScenePath} onSceneOpened={() => setRequestedScenePath(null)} /> : section === 'timeline' ? <TimelinePanel onOpenLore={(path) => { setSection('library'); void openDocument(path) }} onOpenScene={(path) => { setRequestedScenePath(path); setSection('manuscript') }} /> : section === 'relationships' ? <RelationshipPanel onOpenLore={(path) => { setSection('library'); void openDocument(path) }} /> : <section className="library-main">
        <header className="library-header">
          <div><p className="eyebrow">LOCAL LORE LIBRARY</p><h2>{document?.title ?? (selectedFolder ? `lore/${selectedFolder}` : 'lore')}</h2></div>
          {document && <div className="document-controls"><span className={isDirty ? 'save-state dirty' : 'save-state'}>{isDirty ? 'Saving…' : 'Saved locally'}</span><div className="view-toggle"><button className={viewMode === 'read' ? 'selected' : ''} onClick={() => setViewMode('read')}>Read</button><button className={viewMode === 'edit' ? 'selected' : ''} onClick={() => setViewMode('edit')}>Edit</button></div></div>}
        </header>
        <div className="library-workspace"><aside className="binder lore-binder" aria-label="Lore files" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); try { const node = JSON.parse(event.dataTransfer.getData('application/x-worldvilla-tree-node')) as LoreTreeNode; if (node.path) void moveNode(node, '') } catch { /* Ignore drops from outside the file tree. */ } }}><div className="tree-heading"><strong>Lore</strong><button className="tree-new" title="Create a new lore entry or folder" onClick={() => { setDocument(null); setDraft(''); setBacklinks([]); setIsDirty(false) }}>+ New</button></div><Tree nodes={tree} selectedFile={document?.path ?? null} selectedFolder={selectedFolder} onFile={(node) => void openDocument(node.path)} onFolder={(path) => { setSelectedFolder(path); setContextMenu(null) }} onMove={(node, destination) => void moveNode(node, destination)} onContext={(node, x, y) => setContextMenu({ node, x, y })} />{contextMenu && <div className="tree-context-menu" onPointerDown={(event) => event.stopPropagation()} style={{ left: contextMenu.x, top: contextMenu.y }}><strong>{contextMenu.node.name}</strong>{contextMenu.node.kind === 'folder' && <button onClick={() => { void renameFolder(contextMenu.node.path); setContextMenu(null) }}>Rename folder</button>}<button className="danger" onClick={() => { if (contextMenu.node.kind === 'file') void deleteDocument(contextMenu.node.path, contextMenu.node.name); else void deleteFolder(contextMenu.node.path); setContextMenu(null) }}>Delete</button></div>}</aside><section className="library-content">{document ? <Editor document={document} draft={draft} mode={viewMode} references={references} backlinks={backlinks} onOpenReference={(documentPath) => void openDocument(documentPath)} onUpdateProperties={(patch) => void updateProperties(patch)} onChange={(value) => { setDraft(value); setIsDirty(true) }} /> : <CreatePanel mode={createMode} setMode={setCreateMode} name={createName} setName={setCreateName} type={createType} setType={setCreateType} customTypes={[...new Set(references.flatMap((reference) => reference.type && !builtInLoreTypes.includes(reference.type) ? [reference.type] : []))].sort()} parent={selectedFolder} isWorking={isWorking} onCreate={() => void createEntry()} />}{(lastRescan || lastChange || error) && <footer className="library-status">{lastRescan && <span>Scanned {lastRescan.fileCount} files.</span>}{lastChange && <span>External change: {lastChange.path} was {lastChange.type}.</span>}{error && <span className="error" role="alert">{error}</span>}</footer>}</section></div>
      </section>}
    </main>
  )
}

function RelationshipPanel(props: { onOpenLore: (path: string) => void }): React.JSX.Element {
  const [graph, setGraph] = useState<RelationshipGraph>({ schemaVersion: 1, relationships: [], customTypes: [], positions: {}, views: [] })
  const [references, setReferences] = useState<LoreReference[]>([])
  const [fromPath, setFromPath] = useState('')
  const [editingRelationship, setEditingRelationship] = useState<Relationship | null>(null)
  const [toPath, setToPath] = useState('')
  const [kind, setKind] = useState<RelationshipKind>('parent')
  const [parentRole, setParentRole] = useState<'maternal' | 'paternal' | ''>('')
  const [customTypeId, setCustomTypeId] = useState('')
  const [newCustomType, setNewCustomType] = useState('')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')
  const [focusPath, setFocusPath] = useState('')
  const [savedViewName, setSavedViewName] = useState('')
  const [types, setTypes] = useState<LoreEntityType[]>(['character', 'place', 'faction', 'item', 'event', 'note'])
  const [view, setView] = useState<'graph' | 'family' | 'relationships'>('graph')
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ path: string; offsetX: number; offsetY: number } | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragMovedRef = useRef(false)
  useEffect(() => { void Promise.all([window.worldvilla.relationships.get(), window.worldvilla.lore.listReferences()]).then(([saved, lore]) => { setGraph(saved); setReferences(lore); setTypes([...new Set(lore.flatMap((entry) => entry.type ? [entry.type] : []))]) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load relationships.')) }, [])
  const reference = (path: string): LoreReference | undefined => references.find((entry) => entry.path === path)
  const referenceName = (path: string): string => reference(path)?.title ?? (path.startsWith('unknown:') ? `Unknown ${path.slice('unknown:'.length)}` : path)
  const relationshipLabel = (relationship: Relationship): string => relationship.kind === 'custom' ? (graph.customTypes.find((type) => type.id === relationship.customTypeId)?.name ?? relationship.label) || 'Custom relationship' : [relationship.parentRole ?? relationship.kind, relationship.label].filter(Boolean).join(' · ')
  const LoreLink = ({ path }: { path: string }): React.JSX.Element => path.startsWith('unknown:') ? <>{referenceName(path)}</> : <button className="relationship-link" onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onOpenLore(path)}>{referenceName(path)}</button>
  const availableTypes = [...new Set(references.flatMap((entry) => entry.type ? [entry.type] : []))].sort()
  const visibleRelationships = graph.relationships.filter((relationship) => (!focusPath || relationship.fromPath === focusPath || relationship.toPath === focusPath) && [relationship.fromPath, relationship.toPath].every((path) => { const entry = reference(path); return !entry?.type || types.includes(entry.type) }))
  const visiblePaths = new Set(visibleRelationships.flatMap((relationship) => [relationship.fromPath, relationship.toPath]))
  const graphPaths = [...visiblePaths]
  const stageDimensions = graphPaths.reduce((size, path, index) => {
    const position = graph.positions[path] ?? { x: 32 + (index % 4) * 190, y: 32 + Math.floor(index / 4) * 125 }
    return { width: Math.max(size.width, position.x + 215), height: Math.max(size.height, position.y + 120) }
  }, { width: 760, height: 500 })
  const toggleType = (type: LoreEntityType): void => setTypes((current) => current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type])
  const create = async (event: React.FormEvent): Promise<void> => { event.preventDefault(); try { const input = { fromPath, toPath, kind, parentRole: parentRole || undefined, customTypeId: customTypeId || undefined, label, notes }; const saved = editingRelationship ? await window.worldvilla.relationships.update(editingRelationship.id, input) : await window.worldvilla.relationships.create(input); setGraph((current) => ({ ...current, relationships: editingRelationship ? current.relationships.map((entry) => entry.id === saved.id ? saved : entry) : [...current.relationships, saved] })); setEditingRelationship(null); setToPath(''); setLabel(''); setNotes(''); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save relationship.') } }
  const editRelationship = (relationship: Relationship): void => { setEditingRelationship(relationship); setFromPath(relationship.fromPath); setToPath(relationship.toPath); setKind(relationship.kind); setParentRole(relationship.parentRole ?? ''); setCustomTypeId(relationship.customTypeId ?? ''); setLabel(relationship.label); setNotes(relationship.notes) }
  const addCustomType = async (): Promise<void> => { try { const saved = await window.worldvilla.relationships.createType({ name: newCustomType }); setGraph((current) => ({ ...current, customTypes: [...current.customTypes, saved].sort((left, right) => left.name.localeCompare(right.name)) })); setKind('custom'); setCustomTypeId(saved.id); setNewCustomType(''); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add relationship type.') } }
  const removeCustomType = async (id: string): Promise<void> => { try { await window.worldvilla.relationships.deleteType(id); setGraph((current) => ({ ...current, customTypes: current.customTypes.filter((type) => type.id !== id) })); if (customTypeId === id) setCustomTypeId('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove relationship type.') } }
  const remove = async (relationship: Relationship): Promise<void> => { if (!window.confirm(`Remove ${relationship.kind} relationship?`)) return; try { await window.worldvilla.relationships.delete(relationship.id); setGraph((current) => ({ ...current, relationships: current.relationships.filter((entry) => entry.id !== relationship.id) })) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove relationship.') } }
  const saveView = async (): Promise<void> => { try { const saved = await window.worldvilla.relationships.saveView({ name: savedViewName, focusPath: focusPath || undefined, types }); setGraph((current) => ({ ...current, views: [...current.views, saved] })); setSavedViewName('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save view.') } }
  const deleteView = async (id: string): Promise<void> => { try { await window.worldvilla.relationships.deleteView(id); setGraph((current) => ({ ...current, views: current.views.filter((entry) => entry.id !== id) })) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete saved view.') } }
  const exportGraph = async (): Promise<void> => { try { await window.worldvilla.relationships.export(); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export relationships.') } }
  const importGraph = async (): Promise<void> => { try { const imported = await window.worldvilla.relationships.import(); if (imported) setGraph(imported); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to import relationships.') } }
  const nodePosition = (path: string, index: number): { x: number; y: number } => graph.positions[path] ?? { x: 32 + (index % 4) * 190, y: 32 + Math.floor(index / 4) * 125 }
  const beginDrag = (event: React.PointerEvent<HTMLElement>, path: string, index: number): void => { const box = stageRef.current?.getBoundingClientRect(); if (!box) return; dragMovedRef.current = false; const position = nodePosition(path, index); setDragging({ path, offsetX: event.clientX - box.left - position.x, offsetY: event.clientY - box.top - position.y }); event.currentTarget.setPointerCapture(event.pointerId) }
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>): void => { if (!dragging || !stageRef.current) return; dragMovedRef.current = true; const box = stageRef.current.getBoundingClientRect(); const position = { x: Math.max(0, event.clientX - box.left - dragging.offsetX), y: Math.max(0, event.clientY - box.top - dragging.offsetY) }; setGraph((current) => ({ ...current, positions: { ...current.positions, [dragging.path]: position } })) }
  const endDrag = (): void => { if (!dragging) return; const draggedPath = dragging.path; setDragging(null); if (!dragMovedRef.current) { props.onOpenLore(draggedPath); return } void window.worldvilla.relationships.savePositions(graph.positions).then(setGraph).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to save graph layout.')) }
  const familyRelationships = visibleRelationships.filter((relationship) => ['parent', 'sibling', 'spouse', 'partner', 'adoption', 'guardian'].includes(relationship.kind))
  return <section className="library-main relationship-main"><header className="library-header"><div><p className="eyebrow">WORLD RELATIONSHIPS</p><h2>Relationship graph</h2></div><div className="relationship-actions"><button className="secondary" onClick={() => void importGraph()}>Import</button><button className="secondary" onClick={() => void exportGraph()}>Export</button><div className="view-toggle"><button className={view === 'graph' ? 'selected' : ''} onClick={() => setView('graph')}>Graph</button><button className={view === 'family' ? 'selected' : ''} onClick={() => setView('family')}>Family</button><button className={view === 'relationships' ? 'selected' : ''} onClick={() => setView('relationships')}>All relationships</button></div></div></header><div className="relationship-workspace"><aside className="relationship-controls"><h3>Focus & filter</h3><label>Focus<select value={focusPath} onChange={(event) => setFocusPath(event.target.value)}><option value="">Entire world</option>{references.map((entry) => <option key={entry.path} value={entry.path}>{entry.title} · {entry.type ?? 'lore'}</option>)}</select></label><fieldset><legend>Show node types</legend>{availableTypes.map((type) => <label key={type}><input type="checkbox" checked={types.includes(type)} onChange={() => toggleType(type)} /> {type}</label>)}</fieldset><div className="saved-views"><label>Save current view<input value={savedViewName} onChange={(event) => setSavedViewName(event.target.value)} placeholder="View name" /></label><button type="button" onClick={() => void saveView()}>Save view</button>{graph.views.map((entry) => <p key={entry.id}><button type="button" onClick={() => { setFocusPath(entry.focusPath ?? ''); setTypes(entry.types) }}>{entry.name}</button><button className="danger" type="button" onClick={() => void deleteView(entry.id)}>×</button></p>)}</div><div className="custom-relationship-types"><label>Custom relationship types<input value={newCustomType} onChange={(event) => setNewCustomType(event.target.value)} placeholder="e.g. mentor" /></label><button type="button" onClick={() => void addCustomType()}>Add type</button>{graph.customTypes.map((type) => <p key={type.id}><span>{type.name}</span><button className="danger" type="button" onClick={() => void removeCustomType(type.id)}>×</button></p>)}</div><form onSubmit={(event) => void create(event)}><h3>{editingRelationship ? 'Edit relationship' : 'Add relationship'}</h3><label>From<select value={fromPath} onChange={(event) => setFromPath(event.target.value)} required><option value="">Choose lore entry…</option>{kind === 'parent' && <option value="unknown:parent">Unknown parent</option>}{references.map((entry) => <option key={entry.path} value={entry.path}>{entry.title}</option>)}</select></label><label>Relationship<select value={kind === 'custom' ? `custom:${customTypeId}` : kind} onChange={(event) => { const value = event.target.value; if (value.startsWith('custom:')) { setKind('custom'); setCustomTypeId(value.slice('custom:'.length)) } else { setKind(value as RelationshipKind); setCustomTypeId('') }; setParentRole('') }}>{relationshipKinds.filter((entry) => entry !== 'custom').map((entry) => <option key={entry} value={entry}>{entry}</option>)}{graph.customTypes.length > 0 && <optgroup label="Custom types">{graph.customTypes.map((type) => <option key={type.id} value={`custom:${type.id}`}>{type.name}</option>)}</optgroup>}{graph.customTypes.length === 0 && <option value="custom:">Custom type (add one above)</option>}</select></label>{kind === 'parent' && <label>Parent role<select value={parentRole} onChange={(event) => setParentRole(event.target.value as 'maternal' | 'paternal' | '')}><option value="">Unspecified</option><option value="maternal">Maternal</option><option value="paternal">Paternal</option></select></label>}<label>To<select value={toPath} onChange={(event) => setToPath(event.target.value)} required><option value="">Choose lore entry…</option>{kind === 'parent' && <option value="unknown:parent">Unknown parent</option>}{references.filter((entry) => entry.path !== fromPath).map((entry) => <option key={entry.path} value={entry.path}>{entry.title}</option>)}</select></label><label>Label <small>{kind === 'custom' ? '(optional context)' : '(optional)'}</small><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. heir apparent" /></label><label>Notes <small>(optional)</small><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button type="submit">{editingRelationship ? 'Save relationship' : 'Add relationship'}</button>{editingRelationship && <button type="button" className="secondary" onClick={() => setEditingRelationship(null)}>Cancel</button>}</form></aside><main className="relationship-canvas">{view === 'graph' ? <><p className="eyebrow">{visibleRelationships.length} CONNECTION{visibleRelationships.length === 1 ? '' : 'S'} · DRAG NODES TO ARRANGE</p><div className="graph-stage" ref={stageRef} style={{ width: stageDimensions.width, height: stageDimensions.height }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><svg className="graph-links" aria-label="Relationship connections">{visibleRelationships.map((relationship) => { const fromIndex = graphPaths.indexOf(relationship.fromPath); const toIndex = graphPaths.indexOf(relationship.toPath); const from = nodePosition(relationship.fromPath, fromIndex); const to = nodePosition(relationship.toPath, toIndex); const labelX = (from.x + to.x) / 2 + 82; const labelY = (from.y + to.y) / 2 + 36; return <g className="graph-edge" key={relationship.id} role="button" tabIndex={0} onClick={() => editRelationship(relationship)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') editRelationship(relationship) }}><title>Edit {relationshipLabel(relationship)} relationship</title><line x1={from.x + 82} y1={from.y + 40} x2={to.x + 82} y2={to.y + 40} /><text x={labelX} y={labelY}>{relationshipLabel(relationship)}</text></g> })}</svg>{graphPaths.map((path, index) => { const position = nodePosition(path, index); return <article key={path} className={`graph-node ${reference(path)?.type ?? 'note'}`} style={{ left: position.x, top: position.y }} onPointerDown={(event) => beginDrag(event, path, index)}><small>{reference(path)?.type ?? 'lore'}</small><strong><LoreLink path={path} /></strong></article> })}</div><ol className="graph-edges">{visibleRelationships.map((relationship) => <li key={relationship.id}><strong><LoreLink path={relationship.fromPath} /></strong><span>{relationshipLabel(relationship)}</span><strong><LoreLink path={relationship.toPath} /></strong></li>)}</ol></> : view === 'family' ? <><p className="eyebrow">LINEAGE & KINSHIP</p><p className="relationship-note">Parentage, siblings, adoption, guardianship, and partnerships are shown here. Succession remains a separate relationship type.</p><ol className="family-tree">{familyRelationships.map((relationship) => <li key={relationship.id}><strong><LoreLink path={relationship.fromPath} /></strong><span>{relationshipLabel(relationship)}</span><strong><LoreLink path={relationship.toPath} /></strong>{relationship.label && <small>{relationship.label}</small>}</li>)}</ol></> : <ol className="relationship-list">{visibleRelationships.map((relationship) => <li key={relationship.id}><div><strong><LoreLink path={relationship.fromPath} /></strong><span>{relationshipLabel(relationship)}</span><strong><LoreLink path={relationship.toPath} /></strong>{relationship.notes && <small>{relationship.notes}</small>}</div><span className="relationship-list-actions"><button onClick={() => editRelationship(relationship)}>Edit</button><button className="danger" onClick={() => void remove(relationship)}>Delete</button></span></li>)}</ol>}{visibleRelationships.length === 0 && <p className="empty-state">No relationships match these filters.</p>}</main></div>{error && <p className="error" role="alert">{error}</p>}</section>
}

const relationshipKinds: RelationshipKind[] = ['parent', 'sibling', 'spouse', 'custom', 'partner', 'adoption', 'guardian', 'rivalry', 'allegiance', 'membership', 'ownership', 'succession']

function TimelinePanel(props: { onOpenLore: (path: string) => void; onOpenScene: (path: string) => void }): React.JSX.Element {
  const [config, setConfig] = useState<TimelineConfig | null>(null)
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [timelineTracks, setTimelineTracks] = useState<TimelineTrack[]>([])
  const [states, setStates] = useState<StateTransition[]>([])
  const [warnings, setWarnings] = useState<Array<{ transitionIds: string[]; message: string }>>([])
  const [stateSubjectPath, setStateSubjectPath] = useState('')
  const [stateField, setStateField] = useState<StateTransition['field']>('holder')
  const [stateValue, setStateValue] = useState('')
  const [stateFrom, setStateFrom] = useState('')
  const [stateDate, setStateDate] = useState('')
  const [stateEventId, setStateEventId] = useState('')
  const [stateNotes, setStateNotes] = useState('')
  const [querySubjectPath, setQuerySubjectPath] = useState('')
  const [queryField, setQueryField] = useState<StateTransition['field']>('holder')
  const [queryDate, setQueryDate] = useState('')
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [tracks, setTracks] = useState<string[]>([])
  const [storyTags, setStoryTags] = useState('')
  const [scenePaths, setScenePaths] = useState<string[]>([])
  const [placePaths, setPlacePaths] = useState<string[]>([])
  const [characterPaths, setCharacterPaths] = useState<string[]>([])
  const [lorePaths, setLorePaths] = useState<string[]>([])
  const [editing, setEditing] = useState<TimelineEvent | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [trackFilter, setTrackFilter] = useState<string | null>(null)
  const [chartZoom, setChartZoom] = useState(100)
  const [timelineView, setTimelineView] = useState<'chronology' | 'lanes' | 'pov' | 'events' | 'continuity'>('chronology')
  const [povPaths, setPovPaths] = useState<string[]>([])
  const [references, setReferences] = useState<LoreReference[]>([])
  const [scenes, setScenes] = useState<ManuscriptNode[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { void Promise.all([window.worldvilla.timeline.get(), window.worldvilla.lore.listReferences(), window.worldvilla.manuscript.list(), window.worldvilla.timeline.continuityWarnings()]).then(([timeline, lore, binder, continuity]) => { setConfig(timeline.config); setEvents(timeline.events); setTimelineTracks(timeline.tracks); setStates(timeline.states); setWarnings(continuity); setReferences(lore); setScenes(flattenManuscript(binder).filter((node) => node.kind === 'scene')) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load the timeline.')) }, [])
  const saveConfig = async (): Promise<void> => { if (!config) return; try { setConfig(await window.worldvilla.timeline.saveConfig(config)); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save the master timeline.') } }
  const clearForm = (): void => { setEditorOpen(false); setEditing(null); setTitle(''); setDate(''); setEndDate(''); setTracks([]); setStoryTags(''); setScenePaths([]); setPlacePaths([]); setCharacterPaths([]); setLorePaths([]) }
  const newEvent = (): void => { clearForm(); setTimelineView('events'); setEditorOpen(true) }
  const edit = (entry: TimelineEvent): void => { setTimelineView('events'); setEditorOpen(true); setEditing(entry); setTitle(entry.title); setDate(entry.masterDate); setEndDate(entry.masterEndDate ?? ''); setTracks(entry.tracks); setStoryTags(entry.storyTags.join(', ')); setScenePaths(entry.scenePaths); setPlacePaths(entry.placePaths); setCharacterPaths(entry.characterPaths); setLorePaths(entry.lorePaths) }
  const create = async (event: React.FormEvent): Promise<void> => { event.preventDefault(); if (!/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(date) || (endDate && !/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(endDate))) { setError('Choose a valid master start time and, if used, end time.'); return } try { const input = { title, masterDate: date, masterEndDate: endDate || undefined, tracks, storyTags: storyTags.split(',').map((tag) => tag.trim()).filter(Boolean), placePaths, characterPaths, scenePaths, lorePaths }; const saved = editing ? await window.worldvilla.timeline.updateEvent(editing.id, input) : await window.worldvilla.timeline.createEvent(input); setEvents((current) => [...current.filter((entry) => entry.id !== saved.id), saved].sort((a, b) => a.masterDate.localeCompare(b.masterDate))); void window.worldvilla.timeline.get().then((timeline) => setTimelineTracks(timeline.tracks)); clearForm(); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save event.') } }
  const remove = async (entry: TimelineEvent): Promise<void> => { if (!window.confirm(`Delete “${entry.title}”?`)) return; try { await window.worldvilla.timeline.deleteEvent(entry.id); setEvents((current) => current.filter((event) => event.id !== entry.id)); if (editing?.id === entry.id) clearForm() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete event.') } }
  const createState = async (event: React.FormEvent): Promise<void> => { event.preventDefault(); if (!stateSubjectPath || !stateValue.trim() || !/^\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(stateDate)) { setError('Choose a subject, state, and valid effective date.'); return } try { const saved = await window.worldvilla.timeline.createState({ subjectPath: stateSubjectPath, field: stateField, from: stateFrom || undefined, to: stateValue, effectiveDate: stateDate, eventId: stateEventId || undefined, notes: stateNotes }); setStates((current) => [...current, saved].sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate))); setWarnings(await window.worldvilla.timeline.continuityWarnings()); setStateFrom(''); setStateValue(''); setStateDate(''); setStateEventId(''); setStateNotes(''); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to record state.') } }
  const removeState = async (state: StateTransition): Promise<void> => { if (!window.confirm('Delete this state transition?')) return; try { await window.worldvilla.timeline.deleteState(state.id); setStates((current) => current.filter((entry) => entry.id !== state.id)); setWarnings(await window.worldvilla.timeline.continuityWarnings()) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete state.') } }
  const queriedState = querySubjectPath && queryDate ? [...states].filter((state) => state.subjectPath === querySubjectPath && state.field === queryField && state.effectiveDate <= queryDate).sort((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0] : undefined
  const tracksInUse = timelineTracks.filter((track) => events.some((event) => event.tracks.includes(track.name)))
  const visibleEvents = trackFilter ? events.filter((event) => event.tracks.includes(trackFilter)) : events
  const stackedEvents = stackTimelineEvents(visibleEvents)
  const povReferences = references.filter((reference) => povPaths.includes(reference.path))
  const povEvents = povReferences.length ? events.filter((event) => event.characterPaths.some((path) => povPaths.includes(path)) || event.lorePaths.some((path) => povPaths.includes(path)) || event.tracks.some((track) => povReferences.some((reference) => reference.title === track)) || event.scenePaths.some((path) => { const scene = scenes.find((entry) => entry.path === path); return scene?.metadata ? povReferences.some((reference) => scene.metadata?.pov === reference.title || scene.metadata?.characters.includes(reference.title)) : false })) : []
  const povGaps = povEvents.slice(1).flatMap((event, index) => masterMoment(event.masterDate) - masterMoment(povEvents[index].masterEndDate ?? povEvents[index].masterDate) > 365 ? [{ from: povEvents[index], to: event }] : [])
  return <section className="library-main timeline-main"><header className="library-header"><div><p className="eyebrow">STORY CHRONOLOGY</p><h2>Master timeline</h2></div></header><div className="timeline-content"><section className="timeline-config"><h3>Master reference span</h3><p>Every event is ordered on this familiar Gregorian-style timeline.</p>{config && <><div className="timeline-config-fields"><label>Start<input value={config.masterStartDate} onChange={(event) => setConfig({ ...config, masterStartDate: event.target.value })} /></label><label>End<input value={config.masterEndDate} onChange={(event) => setConfig({ ...config, masterEndDate: event.target.value })} /></label><button onClick={() => void saveConfig()}>Save settings</button></div><div className="calendar-settings disabled"><label><input type="checkbox" disabled /> My story has multiple calendars</label><p>In-world calendars are planned for a future release. WorldVilla currently uses the master Gregorian timeline only.</p></div></>}</section><section className="timeline-events"><div><h3>Events</h3><p>{visibleEvents.length} event{visibleEvents.length === 1 ? '' : 's'} on the master timeline</p></div><div className="view-toggle"><button className={timelineView === 'chronology' ? 'selected' : ''} onClick={() => { setTimelineView('chronology'); setTrackFilter(null) }}>Chronology</button><button className={timelineView === 'lanes' ? 'selected' : ''} onClick={() => { setTimelineView('lanes'); setTrackFilter(null) }}>Track lanes</button><button className={timelineView === 'pov' ? 'selected' : ''} onClick={() => { setTimelineView('pov'); setTrackFilter(null) }}>POV arc</button><button className={timelineView === 'events' ? 'selected' : ''} onClick={() => { setTimelineView('events'); setTrackFilter(null) }}>Events</button><button className={timelineView === 'continuity' ? 'selected' : ''} onClick={() => { setTimelineView('continuity'); setTrackFilter(null) }}>Continuity</button></div>{timelineView === 'chronology' && tracksInUse.length > 0 && <div className="timeline-filters"><label>Track <select value={trackFilter ?? ''} onChange={(event) => setTrackFilter(event.target.value || null)}><option value="">All tracks</option>{tracksInUse.map((track) => <option key={track.name} value={track.name}>{track.name} · {track.kind}</option>)}</select></label></div>}{timelineView === 'chronology' && config && <section className="timeline-interval-chart"><header className="timeline-chart-header"><p className="eyebrow">EVENT DURATIONS</p><label>Zoom <input type="range" min="100" max="300" step="25" value={chartZoom} onChange={(event) => setChartZoom(Number(event.target.value))} /> {chartZoom}%</label></header><div className="timeline-chart-scroll"><div className="timeline-stack" style={{ width: `${chartZoom}%`, height: `${Math.max(1, stackedEvents.reduce((highest, item) => Math.max(highest, item.lane + 1), 0)) * 2.55 + .4}rem` }}>{stackedEvents.map(({ event, lane }) => { const interval = timelineInterval(event, config); return <div className="timeline-bar" key={event.id} title={`${event.title} · ${timelineRange(event)}`} style={{ left: `${interval.left}%`, width: `${interval.width}%`, top: `${lane * 2.55 + .3}rem` }}><strong>{event.title}</strong><small>{timelineRange(event)}</small></div> })}</div></div></section>}{timelineView === 'events' && <div className="timeline-events-toolbar"><button onClick={newEvent}>New event</button><span>Manage timeline events</span></div>}{editorOpen && timelineView === 'events' && <div className="timeline-editor"><header><h4>{editing ? 'Edit event' : 'New event'}</h4><button onClick={clearForm}>Close</button></header><form onSubmit={(event) => void create(event)}><label className="timeline-when">Starts<input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="timeline-when">Ends <small>(optional)</small><input type="datetime-local" value={endDate} onChange={(event) => setEndDate(event.target.value)} /></label><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Event title" required /><TokenPicker label="Tracks" allowCreate options={tracksInUse.map((track) => ({ id: track.name, label: track.name, detail: track.kind }))} value={tracks} onChange={setTracks} /><input value={storyTags} onChange={(event) => setStoryTags(event.target.value)} placeholder="Story tags · clue, reveal" /><TokenPicker label="Places" required options={references.filter((reference) => reference.type === 'place').map((reference) => ({ id: reference.path, label: reference.title, detail: 'Place' }))} value={placePaths} onChange={setPlacePaths} /><TokenPicker label="Characters" options={references.filter((reference) => reference.type === 'character').map((reference) => ({ id: reference.path, label: reference.title, detail: 'Character' }))} value={characterPaths} onChange={setCharacterPaths} /><TokenPicker label="Scenes" options={scenes.map((scene) => ({ id: scene.path, label: scene.title, detail: scene.path }))} value={scenePaths} onChange={setScenePaths} /><TokenPicker label="Related lore" options={references.map((reference) => ({ id: reference.path, label: reference.title, detail: reference.type }))} value={lorePaths} onChange={setLorePaths} /><button type="submit">{editing ? 'Save event' : 'Add event'}</button><button type="button" onClick={clearForm}>Cancel</button></form></div>}{timelineView === 'continuity' ? <section className="continuity-panel"><header><div><p className="eyebrow">DATED STATE HISTORY</p><h4>Continuity</h4></div>{warnings.length > 0 && <strong className="continuity-warning">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</strong>}</header>{warnings.map((warning, index) => <p className="continuity-warning" key={`${warning.message}-${index}`}>{warning.message}</p>)}<section className="continuity-query"><h5>State at a moment</h5><div><label>Subject<select value={querySubjectPath} onChange={(event) => setQuerySubjectPath(event.target.value)}><option value="">Choose lore entry…</option>{references.map((reference) => <option key={reference.path} value={reference.path}>{reference.title}</option>)}</select></label><label>State<select value={queryField} onChange={(event) => setQueryField(event.target.value as StateTransition['field'])}><option value="holder">Holder</option><option value="location">Location</option><option value="lifeStatus">Life status</option><option value="allegiance">Allegiance</option></select></label><label>At<input type="datetime-local" value={queryDate} onChange={(event) => setQueryDate(event.target.value)} /></label></div>{querySubjectPath && queryDate && <p>{queriedState ? <><strong>{queriedState.to}</strong> since {queriedState.effectiveDate}</> : 'No recorded state at or before this moment.'}</p>}</section><form onSubmit={(event) => void createState(event)}><label>Subject<select value={stateSubjectPath} onChange={(event) => setStateSubjectPath(event.target.value)} required><option value="">Choose lore entry…</option>{references.map((reference) => <option key={reference.path} value={reference.path}>{reference.title} · {reference.type}</option>)}</select></label><label>State<select value={stateField} onChange={(event) => setStateField(event.target.value as StateTransition['field'])}><option value="holder">Holder</option><option value="location">Location</option><option value="lifeStatus">Life status</option><option value="allegiance">Allegiance</option></select></label><label>Previous value<input value={stateFrom} onChange={(event) => setStateFrom(event.target.value)} placeholder="Optional check" /></label><label>New value<input value={stateValue} onChange={(event) => setStateValue(event.target.value)} placeholder="New state" required /></label><label>Effective<input type="datetime-local" value={stateDate} onChange={(event) => setStateDate(event.target.value)} required /></label><label>Linked event<select value={stateEventId} onChange={(event) => setStateEventId(event.target.value)}><option value="">None</option>{events.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></label><label>Notes<input value={stateNotes} onChange={(event) => setStateNotes(event.target.value)} placeholder="Optional context" /></label><button type="submit">Record state</button></form><ol>{states.map((state) => <li key={state.id} className={warnings.some((warning) => warning.transitionIds.includes(state.id)) ? 'has-warning' : ''}><time>{state.effectiveDate}</time><div><strong><button className="timeline-text-link" onClick={() => props.onOpenLore(state.subjectPath)}>{references.find((reference) => reference.path === state.subjectPath)?.title ?? state.subjectPath}</button></strong><span>{state.field}: {state.from ? `${state.from} → ` : ''}{state.to}</span>{state.eventId && <small>{events.find((entry) => entry.id === state.eventId)?.title ?? 'Linked event'}</small>}</div><button className="danger" onClick={() => void removeState(state)}>Delete</button></li>)}</ol></section> : timelineView === 'pov' ? <section className="pov-arc"><TokenPicker label="Characters" options={references.filter((reference) => reference.type === 'character').map((reference) => ({ id: reference.path, label: reference.title, detail: 'Character' }))} value={povPaths} onChange={setPovPaths} />{povReferences.length > 0 && <><p>{povEvents.length} linked event{povEvents.length === 1 ? '' : 's'} for {povReferences.map((reference) => reference.title).join(' · ')}. Scene metadata is included when those scenes are linked to events.</p>{povGaps.length > 0 && <section className="pov-gaps"><strong>Timeline gaps over one year</strong>{povGaps.map((gap) => <p key={`${gap.from.id}-${gap.to.id}`}>{gap.from.title} → {gap.to.title}</p>)}</section>}<ol>{povEvents.map((event) => <li key={event.id}><time>{timelineRange(event)}</time><div><strong>{event.title}</strong>{event.scenePaths.length > 0 && <small>Scenes: {event.scenePaths.map((path) => scenes.find((scene) => scene.path === path)?.title ?? path).join(' · ')}</small>}</div></li>)}</ol></>}</section> : timelineView === 'lanes' ? <div className="timeline-lanes">{tracksInUse.map((track) => <section key={track.name}><h4>{track.referencePath ? <button className="timeline-text-link" onClick={() => props.onOpenLore(track.referencePath!)}>{track.name}</button> : track.name} <small>{track.kind}</small></h4><ol>{events.filter((event) => event.tracks.includes(track.name)).map((event) => <li key={event.id}><time>{timelineRange(event)}</time><strong>{event.title}</strong></li>)}</ol></section>)}</div> : <ol>{visibleEvents.map((event) => <li key={event.id}><time>{timelineRange(event)}</time><div><strong>{event.title}</strong>{event.inWorldDate && <span>{event.inWorldDate}</span>}{event.tracks.length > 0 && <small>{event.tracks.join(' · ')}</small>}{event.storyTags.length > 0 && <small className="story-tags">{event.storyTags.map((tag) => `#${tag}`).join(' ')}</small>}{(event.scenePaths.length > 0 || event.lorePaths.length > 0) && <small>Linked: {[...event.scenePaths.map((path) => scenes.find((scene) => scene.path === path)?.title ?? path), ...event.lorePaths.map((path) => references.find((reference) => reference.path === path)?.title ?? path)].join(' · ')}</small>}{(event.scenePaths.length > 0 || event.lorePaths.length > 0 || event.placePaths.length > 0 || event.characterPaths.length > 0) && <span className="timeline-links">{event.scenePaths.map((path) => <button key={path} onClick={() => props.onOpenScene(path)}>Open scene</button>)}{[...event.placePaths, ...event.characterPaths, ...event.lorePaths].map((path) => <button key={path} onClick={() => props.onOpenLore(path)}>Open lore</button>)}</span>}{timelineView === 'events' && <span className="timeline-event-actions"><button onClick={() => edit(event)}>Edit</button><button className="danger" onClick={() => void remove(event)}>Delete</button></span>}</div></li>)}</ol>}</section>{error && <p className="error" role="alert">{error}</p>}</div></section>
}

function timelineRange(event: TimelineEvent): string {
  return event.masterEndDate ? `${event.masterDate} → ${event.masterEndDate}` : event.masterDate
}

function masterMoment(value: string): number {
  const [date, time = '00:00'] = value.split('T')
  const [year, month, day] = date.split('-').map(Number)
  const [hours, minutes] = time.split(':').map(Number)
  const leap = (candidate: number): boolean => candidate % 4 === 0 && (candidate % 100 !== 0 || candidate % 400 === 0)
  const monthDays = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const priorYears = year - 1
  return priorYears * 365 + Math.floor(priorYears / 4) - Math.floor(priorYears / 100) + Math.floor(priorYears / 400) + monthDays.slice(0, month - 1).reduce((sum, days) => sum + days, 0) + day - 1 + (hours * 60 + minutes) / 1440
}

function stackTimelineEvents(events: TimelineEvent[]): Array<{ event: TimelineEvent; lane: number }> {
  const laneEnds: number[] = []
  return [...events].sort((left, right) => left.masterDate.localeCompare(right.masterDate)).map((event) => {
    const start = masterMoment(event.masterDate)
    const end = masterMoment(event.masterEndDate ?? event.masterDate)
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = end
    return { event, lane }
  })
}

function timelineInterval(event: TimelineEvent, config: TimelineConfig): { left: number; width: number } {
  const start = masterMoment(config.masterStartDate)
  const end = masterMoment(config.masterEndDate) + 1
  const total = end - start
  const left = Math.max(0, Math.min(100, ((masterMoment(event.masterDate) - start) / total) * 100))
  const finish = Math.max(left, Math.min(100, ((masterMoment(event.masterEndDate ?? event.masterDate) - start) / total) * 100))
  return { left, width: Math.max(.8, finish - left) }
}

function TokenPicker(props: { label: string; required?: boolean; allowCreate?: boolean; options: Array<{ id: string; label: string; detail?: string }>; value: string[]; onChange: (value: string[]) => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const options = [...props.options, ...props.value.filter((id) => !props.options.some((option) => option.id === id)).map((id) => ({ id, label: id, detail: 'New track' }))]
  const selected = options.filter((option) => props.value.includes(option.id))
  const matches = options.filter((option) => !props.value.includes(option.id) && option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 8)
  const canCreate = props.allowCreate && query.trim() && !options.some((option) => option.label.toLocaleLowerCase() === query.trim().toLocaleLowerCase())
  const add = (id: string): void => { props.onChange([...props.value, id]); setQuery(''); setOpen(true) }
  return <label className={props.required ? 'token-picker required' : 'token-picker'}>{props.label}{props.required && <em>Required</em>}<span className="token-input">{selected.map((option) => <button type="button" key={option.id} className="token" onClick={() => props.onChange(props.value.filter((id) => id !== option.id))}>{option.label} ×</button>)}<input value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true) }} onBlur={() => setOpen(false)} placeholder={`Search ${props.label.toLocaleLowerCase()}…`} /></span>{open && (matches.length > 0 || canCreate) && <span className="token-options">{matches.map((option) => <button type="button" key={option.id} onMouseDown={(event) => { event.preventDefault(); add(option.id) }}><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</button>)}{canCreate && <button type="button" onMouseDown={(event) => { event.preventDefault(); add(query.trim()) }}><strong>Create “{query.trim()}”</strong><small>Custom track</small></button>}</span>}</label>
}

function ManuscriptPanel(props: { requestedScenePath: string | null; onSceneOpened: () => void }): React.JSX.Element {
  const [binder, setBinder] = useState<ManuscriptNode[]>([])
  const [manuscriptView, setManuscriptView] = useState<'binder' | 'corkboard'>('binder')
  const [corkboard, setCorkboard] = useState<CorkboardLayout>({ schemaVersion: 1, cardOrder: [] })
  const [selected, setSelected] = useState<ManuscriptNode | null>(null)
  const [scene, setScene] = useState<SceneDocument | null>(null)
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)
  const [sceneMode, setSceneMode] = useState<'read' | 'edit'>('read')
  const [inspectorTab, setInspectorTab] = useState<'metadata' | 'reference' | 'versions'>('metadata')
  const [variants, setVariants] = useState<SceneVariant[]>([])
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  const [loreReferences, setLoreReferences] = useState<LoreReference[]>([])
  const [referenceDocument, setReferenceDocument] = useState<LoreDocument | null>(null)
  const [referenceDraft, setReferenceDraft] = useState('')
  const [referenceMode, setReferenceMode] = useState<'read' | 'edit'>('read')
  const [referenceDirty, setReferenceDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const refresh = async (): Promise<void> => setBinder(await window.worldvilla.manuscript.list())
  useEffect(() => { const timer = window.setTimeout(() => { void Promise.all([window.worldvilla.manuscript.list(), window.worldvilla.manuscript.corkboardLayout()]).then(([nodes, layout]) => { setBinder(nodes); setCorkboard(layout) }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load manuscript.')) }, 0); return () => window.clearTimeout(timer) }, [])
  useEffect(() => { const timer = window.setTimeout(() => { void window.worldvilla.lore.listReferences().then(setLoreReferences).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Unable to load lore references.')) }, 0); return () => window.clearTimeout(timer) }, [])
  const select = async (node: ManuscriptNode): Promise<void> => {
    setSelected(node); setError(null)
    if (node.kind !== 'scene') { setScene(null); return }
    try { const [opened, sceneVariants] = await Promise.all([window.worldvilla.manuscript.readScene(node.path), window.worldvilla.manuscript.listSceneVariants(node.path)]); setScene(opened); setVariants(sceneVariants); setActiveVariantId(sceneVariants.find((variant) => variant.preferred)?.id ?? null); setDraft(opened.content); setDirty(false); setSceneMode('read') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open scene.') }
  }
  useEffect(() => {
    if (!props.requestedScenePath) return
    const node = findManuscriptNode(binder, props.requestedScenePath)
    if (!node || node.kind !== 'scene') return
    const timer = window.setTimeout(() => { void select(node).then(props.onSceneOpened) }, 0)
    return () => window.clearTimeout(timer)
    // The selected scene is intentionally opened only when the requested path or Binder changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binder, props.requestedScenePath])
  const create = async (): Promise<void> => {
    const parentPath = selected?.kind === 'scene' ? selected.path.split('/').slice(0, -1).join('/') : selected?.path ?? ''
    const depth = parentPath ? parentPath.split('/').length : 0
    const title = newTitle.trim()
    if (!title) { setError('Enter a title before creating a manuscript item.'); return }
    try {
      if (depth < 3) await window.worldvilla.manuscript.createContainer({ parentPath, title, kind: ['volume', 'part', 'chapter'][depth] as 'volume' | 'part' | 'chapter' })
      else { const created = await window.worldvilla.manuscript.createScene({ parentPath, title, status: 'idea' }); await select({ id: created.id, path: created.path, title: created.title, kind: 'scene', metadata: created.metadata }) }
      setNewTitle('')
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create manuscript item.') }
  }
  const saveScene = async (): Promise<void> => {
    if (!scene || !dirty) return
    try {
      const saved = activeVariantId ? await window.worldvilla.manuscript.saveSceneVariant(scene.path, activeVariantId, draft) : await window.worldvilla.manuscript.saveScene(scene.path, draft)
      setScene(saved); setDraft(saved.content); setDirty(false)
      setVariants(await window.worldvilla.manuscript.listSceneVariants(saved.path))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save scene.') }
  }
  const updateMetadata = async (patch: SceneMetadataPatch): Promise<void> => {
    if (!scene) return
    try {
      const saved = activeVariantId ? await window.worldvilla.manuscript.updateSceneVariantMetadata(scene.path, activeVariantId, patch, draft) : await window.worldvilla.manuscript.updateSceneMetadata(scene.path, patch, draft)
      setScene(saved); setDraft(saved.content); setDirty(false)
      setVariants(await window.worldvilla.manuscript.listSceneVariants(saved.path))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update scene metadata.') }
  }
  const openReference = async (documentPath: string): Promise<void> => {
    try { const opened = await window.worldvilla.lore.read(documentPath); setReferenceDocument(opened); setReferenceDraft(opened.content); setReferenceDirty(false); setReferenceMode('read') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open lore reference.') }
  }
  const saveReference = async (): Promise<void> => {
    if (!referenceDocument) return
    try { const saved = await window.worldvilla.lore.save(referenceDocument.path, referenceDraft); setReferenceDocument(saved); setReferenceDraft(saved.content); setReferenceDirty(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save lore reference.') }
  }
  const selectVariant = async (variantId: string): Promise<void> => {
    if (!scene || variantId === activeVariantId) return
    if (dirty && !window.confirm('Discard unsaved edits before switching versions?')) return
    try { const opened = await window.worldvilla.manuscript.readSceneVariant(scene.path, variantId); setScene(opened); setDraft(opened.content); setDirty(false); setActiveVariantId(variantId) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open scene version.') }
  }
  const createVariant = async (name: string): Promise<void> => {
    if (!scene || !name.trim()) return
    try {
      if (dirty) await saveScene()
      const next = await window.worldvilla.manuscript.createSceneVariant(scene.path, { name, sourceVariantId: activeVariantId ?? undefined })
      setVariants(next)
      const created = next.find((variant) => variant.name === name && variant.id !== activeVariantId)
      if (created) await selectVariant(created.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create a scene version.') }
  }
  const renameVariant = async (variantId: string, name: string): Promise<void> => {
    if (!scene) return
    try { setVariants(await window.worldvilla.manuscript.renameSceneVariant(scene.path, variantId, name)); setError(null) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to rename scene version.') }
  }
  const setPreferredVariant = async (variantId: string): Promise<void> => {
    if (!scene) return
    try {
      const saved = await window.worldvilla.manuscript.setPreferredSceneVariant(scene.path, variantId)
      setScene(saved); setDraft(saved.content); setDirty(false); setActiveVariantId(variantId)
      setVariants(await window.worldvilla.manuscript.listSceneVariants(saved.path))
      await refresh()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to set the preferred version.') }
  }
  const reorder = async (parentPath: string, sourcePath: string, targetPath: string): Promise<void> => {
    if (sourcePath === targetPath) return
    const siblings = findManuscriptChildren(binder, parentPath)
    const paths = siblings.map((node) => node.path)
    const sourceIndex = paths.indexOf(sourcePath)
    const targetIndex = paths.indexOf(targetPath)
    if (sourceIndex < 0 || targetIndex < 0) return
    paths.splice(sourceIndex, 1); paths.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, sourcePath)
    try { setBinder(await window.worldvilla.manuscript.reorder(parentPath, paths)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reorder the binder.') }
  }
  const renameSelected = async (title: string): Promise<void> => {
    if (!selected || title.trim() === selected.title) return
    try {
      if (dirty) await saveScene()
      const renamedPath = await window.worldvilla.manuscript.renameItem({ path: selected.path, title })
      const nodes = await window.worldvilla.manuscript.list()
      setBinder(nodes)
      const renamed = findManuscriptNode(nodes, renamedPath)
      if (renamed) await select(renamed)
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to rename manuscript item.') }
  }
  const exportSelection = async (format: 'markdown' | 'html' | 'docx'): Promise<void> => {
    try {
      const result = await window.worldvilla.manuscript.export(selected?.path ?? '', format)
      if (!result.canceled) setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to export manuscript selection.') }
  }
  const reorderCorkboard = async (order: string[]): Promise<void> => {
    try { setCorkboard(await window.worldvilla.manuscript.saveCorkboardLayout({ schemaVersion: 1, cardOrder: order })) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save corkboard layout.') }
  }
  const selectedParent = selected?.kind === 'scene' ? selected.path.split('/').slice(0, -1).join('/') : selected?.path ?? ''
  const nextLabel = ['Volume', 'Part', 'Chapter', 'Scene'][selectedParent ? selectedParent.split('/').length : 0]
  return <section className="library-main manuscript-main"><header className="library-header"><div><p className="eyebrow">MANUSCRIPT BINDER</p><h2>{scene?.title ?? selected?.title ?? 'Manuscript'}</h2></div><div className="document-controls"><span className={dirty ? 'save-state dirty' : 'save-state'}>{dirty ? 'Saving…' : 'Saved locally'}</span><div className="view-toggle"><button className={manuscriptView === 'binder' ? 'selected' : ''} onClick={() => setManuscriptView('binder')}>Binder</button><button className={manuscriptView === 'corkboard' ? 'selected' : ''} onClick={() => setManuscriptView('corkboard')}>Corkboard</button></div><label className="export-menu"><span className="sr-only">Export manuscript selection</span><select defaultValue="" onChange={(event) => { const format = event.target.value as 'markdown' | 'html' | 'docx' | ''; if (format) { void exportSelection(format); event.currentTarget.value = '' } }}><option value="" disabled>Export…</option><option value="markdown">Markdown (.md)</option><option value="html">HTML (.html)</option><option value="docx">Word document (.docx)</option></select></label><form className="manuscript-create" onSubmit={(event) => { event.preventDefault(); void create() }}><label className="sr-only" htmlFor="manuscript-title">{nextLabel} title</label><input id="manuscript-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder={`New ${nextLabel} title`} /><button type="submit">Create {nextLabel}</button></form></div></header><div className="manuscript-workspace">{manuscriptView === 'corkboard' ? <Corkboard nodes={binder} layout={corkboard} onOpen={(node) => { setManuscriptView('binder'); void select(node) }} onReorder={(order) => void reorderCorkboard(order)} /> : <><aside className="binder"><p className="eyebrow">BINDER</p><p className="binder-hint">Drag a volume, part, chapter, or scene onto a sibling to reorder it.</p><ManuscriptTree nodes={binder} parentPath="" selectedPath={selected?.path ?? ''} onSelect={(node) => void select(node)} onReorder={(parentPath, sourcePath, targetPath) => void reorder(parentPath, sourcePath, targetPath)} /></aside>{scene ? <><section className="scene-editor"><div className="scene-meta"><span>{scene.metadata.status}</span><span>{scene.metadata.pov || 'No POV'}</span><span>{scene.metadata.wordCount} words</span><button className="scene-save" disabled={!dirty} onClick={() => void saveScene()}>{dirty ? 'Save scene' : 'Saved'}</button><div className="view-toggle"><button className={sceneMode === 'read' ? 'selected' : ''} onClick={() => setSceneMode('read')}>Read</button><button className={sceneMode === 'edit' ? 'selected' : ''} onClick={() => setSceneMode('edit')}>Edit</button></div></div>{sceneMode === 'edit' ? <CodeMirror theme={oneDark} value={draft} height="calc(100vh - 225px)" extensions={[markdown(), EditorView.lineWrapping]} onChange={(value) => { setDraft(value); setDirty(true) }} basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: false }} /> : <article className="scene-reading-view"><ReactMarkdown>{markdownBody(draft)}</ReactMarkdown></article>}</section><aside className="scene-inspector"><div className="scene-inspector-tabs"><button className={inspectorTab === 'metadata' ? 'selected' : ''} onClick={() => setInspectorTab('metadata')}>Metadata</button><button className={inspectorTab === 'reference' ? 'selected' : ''} onClick={() => setInspectorTab('reference')}>Reference</button><button className={inspectorTab === 'versions' ? 'selected' : ''} onClick={() => setInspectorTab('versions')}>Versions</button></div>{inspectorTab === 'metadata' ? <SceneMetadataEditor key={scene.path} scene={scene} references={loreReferences} onRename={(title) => void renameSelected(title)} onUpdate={(patch) => void updateMetadata(patch)} /> : inspectorTab === 'reference' ? <SceneReferencePanel references={loreReferences} document={referenceDocument} draft={referenceDraft} mode={referenceMode} dirty={referenceDirty} onOpen={(path) => void openReference(path)} onMode={setReferenceMode} onChange={(value) => { setReferenceDraft(value); setReferenceDirty(true) }} onSave={() => void saveReference()} /> : <SceneVariants variants={variants} activeVariantId={activeVariantId} onCreate={(name) => void createVariant(name)} onRename={(variantId, name) => void renameVariant(variantId, name)} onSelect={(variantId) => void selectVariant(variantId)} onSetPreferred={(variantId) => void setPreferredVariant(variantId)} />}</aside></> : selected ? <><section className="manuscript-empty"><h3>{selected.title}</h3><p>Select a child item or use the metadata sidebar to rename this {selected.kind}.</p></section><aside className="scene-inspector"><ManuscriptItemMetadataEditor key={selected.path} item={selected} onRename={(title) => void renameSelected(title)} /></aside></> : <section className="manuscript-empty"><h3>{binder.length ? 'Build your story outline' : 'Start your manuscript'}</h3>{binder.length ? <p>Select a container, then choose <strong>+ New {nextLabel}</strong> to add the next level: volume → part → chapter → scene.</p> : <><p>Create a volume to begin. A volume is a large section of your work—usually a book, act, or major division.</p><p>Enter its title above, then choose <strong>Create Volume</strong>.</p></>}<p>The binder is the left-hand structure of your manuscript. It lets you organize chapters and scenes before or while you draft them.</p>{error && <p className="error">{error}</p>}</section>}</>}</div></section>
}

function ManuscriptItemMetadataEditor(props: { item: ManuscriptNode; onRename: (title: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState(props.item.title)
  return <section className="manuscript-item-metadata"><p className="eyebrow">MANUSCRIPT METADATA</p><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => props.onRename(title)} /></label><dl><div><dt>Type</dt><dd>{props.item.kind}</dd></div><div><dt>Path</dt><dd>{props.item.path}</dd></div></dl></section>
}

function SceneMetadataEditor(props: { scene: SceneDocument; references: LoreReference[]; onRename: (title: string) => void; onUpdate: (patch: SceneMetadataPatch) => void }): React.JSX.Element {
  const [title, setTitle] = useState(props.scene.title)
  const [pov, setPov] = useState(props.scene.metadata.pov)
  const [inWorldDate] = useState(props.scene.metadata.inWorldDate)
  const [locations, setLocations] = useState(props.scene.metadata.locations.join(', '))
  const [characters, setCharacters] = useState(props.scene.metadata.characters.join(', '))
  const [status, setStatus] = useState(props.scene.metadata.status)
  const [tags, setTags] = useState(props.scene.metadata.tags.join(', '))
  const list = (value: string): string[] => value.split(',').map((entry) => entry.trim()).filter(Boolean)
  const locationsOnly = props.references.filter((reference) => reference.type === 'place')
  return <section className="scene-metadata"><p className="eyebrow">SCENE METADATA</p><label>Scene title<input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => props.onRename(title)} /></label><datalist id="scene-lore-references">{props.references.map((reference) => <option key={reference.path} value={reference.title} />)}</datalist><label>POV<input list="scene-lore-references" value={pov} onChange={(event) => setPov(event.target.value)} onBlur={() => props.onUpdate({ pov })} placeholder="Viewpoint character" /></label><label>In-world date<input value={inWorldDate} disabled placeholder="e.g. 1866-07-07" /></label><label>Locations<CommaReferenceInput value={locations} references={locationsOnly} onChange={setLocations} onBlur={() => props.onUpdate({ locations: list(locations) })} placeholder="comma-separated" /></label><label>Characters<CommaReferenceInput value={characters} references={props.references} onChange={setCharacters} onBlur={() => props.onUpdate({ characters: list(characters) })} placeholder="comma-separated" /></label><label>Status<select value={status} onChange={(event) => { const next = event.target.value as SceneDocument['metadata']['status']; setStatus(next); props.onUpdate({ status: next }) }}><option value="idea">Idea</option><option value="draft">Draft</option><option value="revised">Revised</option><option value="complete">Complete</option></select></label><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={() => props.onUpdate({ tags: list(tags) })} placeholder="comma-separated" /></label><p className="inspector-hint">Word count is calculated automatically when the scene saves.</p></section>
}

function CommaReferenceInput(props: { value: string; references: LoreReference[]; onChange: (value: string) => void; onBlur: () => void; placeholder: string }): React.JSX.Element {
  const [focused, setFocused] = useState(false)
  const parts = props.value.split(',')
  const query = (parts.at(-1) ?? '').trim().toLocaleLowerCase()
  const matches = props.references.filter((reference) => reference.title.toLocaleLowerCase().includes(query) && !parts.slice(0, -1).some((value) => value.trim().toLocaleLowerCase() === reference.title.toLocaleLowerCase())).slice(0, 6)
  const choose = (title: string): void => { parts[parts.length - 1] = ` ${title}`; props.onChange(`${parts.join(',').replace(/^\s+/u, '')}, `) }
  return <span className="comma-reference"><input value={props.value} onFocus={() => setFocused(true)} onChange={(event) => props.onChange(event.target.value)} onBlur={() => { setFocused(false); props.onBlur() }} placeholder={props.placeholder} />{focused && matches.length > 0 && <span className="reference-suggestions">{matches.map((reference) => <button type="button" key={reference.path} onMouseDown={(event) => { event.preventDefault(); choose(reference.title) }}>{reference.title}</button>)}</span>}</span>
}

function SceneReferencePanel(props: { references: LoreReference[]; document: LoreDocument | null; draft: string; mode: 'read' | 'edit'; dirty: boolean; onOpen: (path: string) => void; onMode: (mode: 'read' | 'edit') => void; onChange: (value: string) => void; onSave: () => void }): React.JSX.Element {
  return <section className="scene-reference"><p className="eyebrow">LORE REFERENCE</p><label>Open lore<select value={props.document?.path ?? ''} onChange={(event) => props.onOpen(event.target.value)}><option value="">Choose a lore entry…</option>{props.references.map((reference) => <option key={reference.path} value={reference.path}>{reference.title}</option>)}</select></label>{props.document && <><div className="reference-controls"><div className="view-toggle"><button className={props.mode === 'read' ? 'selected' : ''} onClick={() => props.onMode('read')}>Read</button><button className={props.mode === 'edit' ? 'selected' : ''} onClick={() => props.onMode('edit')}>Edit</button></div>{props.mode === 'edit' && <button disabled={!props.dirty} onClick={props.onSave}>{props.dirty ? 'Save' : 'Saved'}</button>}</div>{props.mode === 'edit' ? <CodeMirror theme={oneDark} value={props.draft} height="calc(100vh - 340px)" extensions={[markdown(), EditorView.lineWrapping]} onChange={props.onChange} basicSetup={{ lineNumbers: false, foldGutter: false }} /> : <article className="reference-reading"><ReactMarkdown>{markdownBody(props.draft)}</ReactMarkdown></article>}</>}</section>
}

function SceneVariants(props: { variants: SceneVariant[]; activeVariantId: string | null; onCreate: (name: string) => void; onRename: (variantId: string, name: string) => void; onSelect: (variantId: string) => void; onSetPreferred: (variantId: string) => void }): React.JSX.Element {
  const [name, setName] = useState('')
  const activeVariant = props.variants.find((variant) => variant.id === props.activeVariantId)
  return <section className="scene-variants"><p className="eyebrow">SCENE VERSIONS</p><p className="inspector-hint">Versions are parallel drafts of the same scene. Choose which version is preferred for the manuscript.</p>{activeVariant && <label className="variant-title">Draft label<input key={activeVariant.id} defaultValue={activeVariant.name} onBlur={(event) => props.onRename(activeVariant.id, event.target.value)} /></label>}<form className="variant-create" onSubmit={(event) => { event.preventDefault(); if (name.trim()) { props.onCreate(name.trim()); setName('') } }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Arya POV" /><button type="submit">New version</button></form><ul>{props.variants.map((variant) => <li key={variant.id} className={variant.id === props.activeVariantId ? 'active' : ''}><button className="variant-open" onClick={() => props.onSelect(variant.id)}><strong>{variant.name}</strong><span>{variant.wordCount} words{variant.preferred ? ' · Preferred' : ''}</span></button>{!variant.preferred && <button className="set-preferred" onClick={() => props.onSetPreferred(variant.id)}>Set preferred</button>}</li>)}</ul></section>
}

function ManuscriptTree(props: { nodes: ManuscriptNode[]; parentPath: string; selectedPath: string; onSelect: (node: ManuscriptNode) => void; onReorder: (parentPath: string, sourcePath: string, targetPath: string) => void }): React.JSX.Element {
  if (!props.nodes.length) return <p className="tree-empty">Start with a volume.</p>
  const dragStart = (event: React.DragEvent, node: ManuscriptNode): void => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-worldvilla-manuscript-node', node.path) }
  const drop = (event: React.DragEvent, target: ManuscriptNode): void => { event.preventDefault(); const source = event.dataTransfer.getData('application/x-worldvilla-manuscript-node'); if (source) props.onReorder(props.parentPath, source, target.path) }
  return <ul className="tree manuscript-tree">{props.nodes.map((node) => <li key={node.path}><button draggable className={props.selectedPath === node.path ? 'tree-node selected' : 'tree-node'} onDragStart={(event) => dragStart(event, node)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, node)} onClick={() => props.onSelect(node)}>{node.kind === 'scene' ? '◦' : '⌄'} {node.title}</button>{node.children && <ManuscriptTree {...props} nodes={node.children} parentPath={node.path} />}</li>)}</ul>
}

function findManuscriptNode(nodes: ManuscriptNode[], targetPath: string): ManuscriptNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) return node
    const child = findManuscriptNode(node.children ?? [], targetPath)
    if (child) return child
  }
  return null
}

function findManuscriptChildren(nodes: ManuscriptNode[], parentPath: string): ManuscriptNode[] {
  if (!parentPath) return nodes
  for (const node of nodes) {
    if (node.path === parentPath) return node.children ?? []
    const found = findManuscriptChildren(node.children ?? [], parentPath)
    if (found.length) return found
  }
  return []
}

function Corkboard(props: { nodes: ManuscriptNode[]; layout: CorkboardLayout; onOpen: (node: ManuscriptNode) => void; onReorder: (order: string[]) => void }): React.JSX.Element {
  const scenes = flattenManuscript(props.nodes).filter((node) => node.kind === 'scene')
  const byId = new Map(scenes.map((scene) => [scene.id, scene]))
  const orderedIds = [...props.layout.cardOrder.filter((id) => byId.has(id)), ...scenes.map((scene) => scene.id).filter((id) => !props.layout.cardOrder.includes(id))]
  const reorder = (source: string, target: string): void => {
    if (source === target) return
    const next = orderedIds.filter((id) => id !== source)
    next.splice(next.indexOf(target), 0, source)
    props.onReorder(next)
  }
  return <section className="corkboard"><header><div><p className="eyebrow">CORKBOARD</p><h3>Scene cards</h3></div><p>Drag cards to arrange your planning view. This does not change Binder order.</p></header>{orderedIds.length ? <div className="corkboard-grid">{orderedIds.map((id) => { const scene = byId.get(id)!; return <article key={id} draggable className="scene-card" onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-worldvilla-corkboard-card', id) }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const source = event.dataTransfer.getData('application/x-worldvilla-corkboard-card'); if (source) reorder(source, id) }} onClick={() => props.onOpen(scene)}><p className="eyebrow">{scene.metadata?.status ?? 'idea'} · {scene.metadata?.wordCount ?? 0} words</p><h4>{scene.title}</h4><dl><div><dt>POV</dt><dd>{scene.metadata?.pov || '—'}</dd></div><div><dt>Date</dt><dd>{scene.metadata?.inWorldDate || '—'}</dd></div></dl>{scene.metadata?.tags.length ? <p className="card-tags">{scene.metadata.tags.join(' · ')}</p> : null}</article> })}</div> : <div className="manuscript-empty"><h3>No scenes yet</h3><p>Create a scene inside a chapter, then it will appear here as a planning card.</p></div>}</section>
}

function flattenManuscript(nodes: ManuscriptNode[]): ManuscriptNode[] {
  return nodes.flatMap((node) => [node, ...flattenManuscript(node.children ?? [])])
}

function Welcome(props: { newWorldName: string; setNewWorldName: (name: string) => void; recents: RecentWorkspace[]; isWorking: boolean; error: string | null; openWorkspace: (action: () => Promise<WorkspaceSummary | null>) => Promise<void> }): React.JSX.Element {
  return <main className="welcome"><section className="hero"><p className="eyebrow">WORLDBUILDING, OWNED BY YOU</p><h1>WorldVilla</h1><p>Build worlds and write stories in a local-first desktop workspace.</p></section><section className="actions" aria-label="Workspace actions"><label htmlFor="world-name">New world name</label><div className="new-world-row"><input id="world-name" value={props.newWorldName} onChange={(event) => props.setNewWorldName(event.target.value)} placeholder="The Seven Kingdoms" /><button disabled={!props.newWorldName.trim() || props.isWorking} onClick={() => void props.openWorkspace(() => window.worldvilla.workspace.create(props.newWorldName))}>Create world</button></div><button className="secondary" disabled={props.isWorking} onClick={() => void props.openWorkspace(() => window.worldvilla.workspace.chooseAndOpen())}>Open existing world</button>{props.error && <p className="error" role="alert">{props.error}</p>}</section>{props.recents.length > 0 && <section className="recents"><h2>Recent worlds</h2>{props.recents.map((recent) => <button key={recent.path} className="recent" disabled={props.isWorking} onClick={() => void props.openWorkspace(() => window.worldvilla.workspace.openRecent(recent.path))}><strong>{recent.name}</strong><span>{recent.path}</span></button>)}</section>}</main>
}

function Tree(props: { nodes: LoreTreeNode[]; selectedFile: string | null; selectedFolder: string; onFile: (node: LoreTreeNode) => void; onFolder: (path: string) => void; onMove: (node: LoreTreeNode, destination: string) => void; onContext: (node: LoreTreeNode, x: number, y: number) => void }): React.JSX.Element {
  if (!props.nodes.length) return <p className="tree-empty">No lore yet.</p>
  const dragStart = (event: React.DragEvent, node: LoreTreeNode): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-worldvilla-tree-node', JSON.stringify({ path: node.path, kind: node.kind, name: node.name }))
  }
  const drop = (event: React.DragEvent, destination: string): void => {
    event.preventDefault()
    event.stopPropagation()
    try {
      const node = JSON.parse(event.dataTransfer.getData('application/x-worldvilla-tree-node')) as LoreTreeNode
      if (node.path) props.onMove(node, destination)
    } catch { /* Ignore drops from outside the file tree. */ }
  }
  return <ul className="tree">{props.nodes.map((node) => <li key={node.path}>{node.kind === 'folder' ? <><button draggable className={props.selectedFolder === node.path ? 'tree-node selected' : 'tree-node'} onDragStart={(event) => dragStart(event, node)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(event, node.path)} onContextMenu={(event) => { event.preventDefault(); props.onContext(node, event.clientX, event.clientY) }} onClick={() => props.onFolder(node.path)}>⌄ {node.name}</button><Tree {...props} nodes={node.children ?? []} /></> : <button draggable className={props.selectedFile === node.path ? 'tree-node selected' : 'tree-node'} onDragStart={(event) => dragStart(event, node)} onContextMenu={(event) => { event.preventDefault(); props.onContext(node, event.clientX, event.clientY) }} onClick={() => props.onFile(node)}>◦ {node.name}</button>}</li>)}</ul>
}

function SearchResults(props: { query: string; results: GlobalSearchResult[]; onOpen: (result: GlobalSearchResult) => void }): React.JSX.Element {
  return <section className="search-results"><p className="eyebrow">GLOBAL SEARCH</p><h3>Results for “{props.query}”</h3>{props.results.length ? <ul>{props.results.map((result) => <li key={`${result.source}:${result.path}`}><button onClick={() => props.onOpen(result)}><span><strong>{result.title}</strong><small>{result.source} · {result.type} · {result.path}</small></span><p>{result.excerpt.replaceAll('<mark>', '').replaceAll('</mark>', '')}</p>{result.tags.length > 0 && <em>{result.tags.join(', ')}</em>}</button></li>)}</ul> : <p className="tree-empty">No matching lore entries or scenes.</p>}</section>
}

const builtInLoreTypes: LoreEntityType[] = ['note', 'character', 'place', 'faction', 'item', 'event']

function CreatePanel(props: { mode: CreateMode; setMode: (mode: CreateMode) => void; name: string; setName: (name: string) => void; type: LoreEntityType; setType: (type: LoreEntityType) => void; customTypes: LoreEntityType[]; parent: string; isWorking: boolean; onCreate: () => void }): React.JSX.Element {
  const [customType, setCustomType] = useState('spell')
  const selectedType = [...builtInLoreTypes, ...props.customTypes].includes(props.type) ? props.type : '__custom'
  return <section className="create-panel"><p className="eyebrow">{props.mode === 'folder' ? 'NEW FOLDER' : 'NEW LORE ENTRY'}</p><h3>{props.parent ? `Create inside ${props.parent}` : 'Start building your world.'}</h3><p>Markdown files remain in your workspace and can be opened without WorldVilla.</p><div className="create-mode"><button className={props.mode === 'document' ? 'selected' : ''} onClick={() => props.setMode('document')}>Entry</button><button className={props.mode === 'folder' ? 'selected' : ''} onClick={() => props.setMode('folder')}>Folder</button></div><label>Name<input autoFocus value={props.name} onChange={(event) => props.setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') props.onCreate() }} placeholder={props.mode === 'folder' ? 'Northern Kingdoms' : 'Arya Stark'} /></label>{props.mode === 'document' && <><label>Type<select value={selectedType} onChange={(event) => props.setType(event.target.value === '__custom' ? customType : event.target.value)}>{builtInLoreTypes.map((type) => <option key={type} value={type}>{type}</option>)}{props.customTypes.map((type) => <option key={type} value={type}>{type}</option>)}<option value="__custom">Custom type…</option></select></label>{selectedType === '__custom' && <label>Custom type<input value={customType} onChange={(event) => { const value = event.target.value.toLocaleLowerCase(); setCustomType(value); props.setType(value) }} placeholder="spell" /><small>Lowercase letters, numbers, and hyphens.</small></label>}</>}<button disabled={!props.name.trim() || props.isWorking} onClick={props.onCreate}>Create {props.mode}</button></section>
}

function Editor(props: { document: LoreDocument; draft: string; mode: 'read' | 'edit'; references: LoreReference[]; backlinks: LoreReference[]; onOpenReference: (path: string) => void; onUpdateProperties: (patch: { title?: string; type?: LoreEntityType; tags?: string[] }) => void; onChange: (value: string) => void }): React.JSX.Element {
  if (props.mode === 'read') return <article className="reading-view"><Properties frontmatter={props.document.frontmatter} /><ReactMarkdown components={{ a: ({ href, children }) => href?.startsWith('#wiki/') ? <button className="wiki-link" onClick={() => props.onOpenReference(decodeURIComponent(href.slice(6)))}>{children}</button> : <a href={href}>{children}</a> }}>{wikiMarkdown(markdownBody(props.draft), props.references)}</ReactMarkdown><Backlinks links={props.backlinks} onOpen={props.onOpenReference} /></article>
  return <div className="editor-layout"><section className="editor"><CodeMirror theme={oneDark} value={props.draft} height="calc(100vh - 152px)" extensions={[markdown(), EditorView.lineWrapping, wikiLinkCompletion(props.references)]} onChange={props.onChange} basicSetup={{ lineNumbers: true, highlightActiveLine: true, foldGutter: false }} /></section><aside className="inspector"><EditableProperties key={props.document.path + props.document.title} frontmatter={props.document.frontmatter} onUpdate={props.onUpdateProperties} /><Backlinks links={props.backlinks} onOpen={props.onOpenReference} compact /><p className="inspector-hint">Type <code>[[</code> to link another lore entry. Edit YAML frontmatter directly in the document.</p></aside></div>
}

function Backlinks(props: { links: LoreReference[]; onOpen: (path: string) => void; compact?: boolean }): React.JSX.Element {
  return <section className={props.compact ? 'backlinks compact' : 'backlinks'}><p className="eyebrow">LINKED MENTIONS</p>{props.links.length ? <ul>{props.links.map((link) => <li key={link.path}><button onClick={() => props.onOpen(link.path)}>{link.title}</button></li>)}</ul> : <p className="empty-backlinks">No incoming links yet.</p>}</section>
}

function EditableProperties(props: { frontmatter: Record<string, unknown>; onUpdate: (patch: { title?: string; type?: LoreEntityType; tags?: string[] }) => void }): React.JSX.Element {
  const [title, setTitle] = useState(typeof props.frontmatter.title === 'string' ? props.frontmatter.title : '')
  const [type, setType] = useState<LoreEntityType>(['character', 'place', 'faction', 'item', 'event', 'note'].includes(String(props.frontmatter.type)) ? props.frontmatter.type as LoreEntityType : 'note')
  const [tags, setTags] = useState(Array.isArray(props.frontmatter.tags) ? props.frontmatter.tags.filter((tag): tag is string => typeof tag === 'string').join(', ') : '')
  const saveTags = (): void => props.onUpdate({ tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean) })
  return <section className="properties editable-properties"><p className="eyebrow">PROPERTIES</p><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} onBlur={() => { if (title.trim() && title !== props.frontmatter.title) props.onUpdate({ title }) }} /></label><label>Type<select value={type} onChange={(event) => { const next = event.target.value as LoreEntityType; setType(next); props.onUpdate({ type: next }) }}>{['note', 'character', 'place', 'faction', 'item', 'event'].map((entry) => <option key={entry} value={entry}>{entry}</option>)}</select></label><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} onBlur={saveTags} placeholder="comma-separated" /></label></section>
}

function Properties(props: { frontmatter: Record<string, unknown> }): React.JSX.Element {
  const entries = Object.entries(props.frontmatter)
  if (!entries.length) return <section className="properties"><p className="eyebrow">PROPERTIES</p><button className="add-property" disabled>+ Add property</button></section>
  return <section className="properties"><p className="eyebrow">PROPERTIES</p><dl>{entries.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value)}</dd></div>)}</dl><button className="add-property" disabled>+ Add property</button></section>
}

function wikiLinkCompletion(references: LoreReference[]) {
  return autocompletion({ override: [(context: CompletionContext) => {
    const match = context.matchBefore(/\[\[[^\]]*/)
    if (!match) return null
    const query = match.text.slice(2).toLocaleLowerCase()
    const options = references.filter((reference) => reference.title.toLocaleLowerCase().includes(query)).map((reference) => ({ label: reference.title, detail: reference.path, type: 'keyword', apply: `${reference.title}]]` }))
    return { from: match.from + 2, options, validFor: /^[^\]]*$/ }
  }] })
}

function markdownBody(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

function wikiMarkdown(content: string, references: LoreReference[]): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (source, target: string, alias?: string) => {
    const normalizedTarget = target.trim().toLocaleLowerCase()
    const reference = references.find((entry) => entry.title.toLocaleLowerCase() === normalizedTarget || entry.path.replace(/\.md$/, '').toLocaleLowerCase() === normalizedTarget)
    if (!reference) return source
    const label = (alias ?? reference.title).trim()
    return `[${label}](#wiki/${encodeURIComponent(reference.path)})`
  })
}
