import { contextBridge, ipcRenderer } from 'electron'
import type { CorkboardLayout, CreateLoreDocument, CreateManuscriptContainer, CreateScene, CreateSceneVariant, CreateTimelineEvent, CreateStateTransition, CreateRelationship, CreateRelationshipType, ContinuityWarning, GlobalSearchResult, LoreDocument, LorePropertyPatch, LoreReference, LoreRenamePreview, LoreSearchFilters, LoreSearchResult, LoreTreeNode, ManuscriptExportFormat, ManuscriptExportResult, ManuscriptNode, RecentWorkspace, Relationship, RelationshipGraph, RelationshipGraphPosition, RelationshipGraphView, SceneDocument, SceneMetadataPatch, SceneSnapshot, SceneVariant, TimelineConfig, TimelineEvent, TimelineEventPatch, TimelineTrack, StateTransition, WorkspaceChange, WorkspaceRescan, WorkspaceSummary } from '../shared/workspace'

const worldvilla = {
  lore: {
    search: (query: string, filters?: LoreSearchFilters): Promise<LoreSearchResult[]> => ipcRenderer.invoke('lore:search', query, filters),
    list: (): Promise<LoreTreeNode[]> => ipcRenderer.invoke('lore:list'),
    listReferences: (): Promise<LoreReference[]> => ipcRenderer.invoke('lore:list-references'),
    listBacklinks: (documentPath: string): Promise<LoreReference[]> => ipcRenderer.invoke('lore:list-backlinks', documentPath),
    read: (documentPath: string): Promise<LoreDocument> => ipcRenderer.invoke('lore:read', documentPath),
    save: (documentPath: string, content: string): Promise<LoreDocument> => ipcRenderer.invoke('lore:save', documentPath, content),
    updateProperties: (documentPath: string, patch: LorePropertyPatch, content?: string): Promise<LoreDocument> => ipcRenderer.invoke('lore:update-properties', documentPath, patch, content),
    previewRename: (documentPath: string, title: string): Promise<LoreRenamePreview> => ipcRenderer.invoke('lore:preview-rename', documentPath, title),
    move: (documentPath: string, destinationFolder: string): Promise<LoreDocument> => ipcRenderer.invoke('lore:move', documentPath, destinationFolder),
    delete: (documentPath: string): Promise<void> => ipcRenderer.invoke('lore:delete', documentPath),
    renameFolder: (folderPath: string, name: string): Promise<string> => ipcRenderer.invoke('lore:rename-folder', folderPath, name),
    moveFolder: (folderPath: string, destinationFolder: string): Promise<string> => ipcRenderer.invoke('lore:move-folder', folderPath, destinationFolder),
    deleteFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('lore:delete-folder', folderPath),
    createDocument: (input: CreateLoreDocument): Promise<LoreDocument> => ipcRenderer.invoke('lore:create-document', input),
    createFolder: (parentPath: string, name: string): Promise<LoreTreeNode[]> => ipcRenderer.invoke('lore:create-folder', parentPath, name)
  },
  manuscript: {
    list: (): Promise<ManuscriptNode[]> => ipcRenderer.invoke('manuscript:list'),
    export: (path: string, format: ManuscriptExportFormat): Promise<ManuscriptExportResult> => ipcRenderer.invoke('manuscript:export', path, format),
    reorder: (parentPath: string, orderedPaths: string[]): Promise<ManuscriptNode[]> => ipcRenderer.invoke('manuscript:reorder', parentPath, orderedPaths),
    corkboardLayout: (): Promise<CorkboardLayout> => ipcRenderer.invoke('manuscript:corkboard-layout'),
    saveCorkboardLayout: (layout: CorkboardLayout): Promise<CorkboardLayout> => ipcRenderer.invoke('manuscript:save-corkboard-layout', layout),
    createContainer: (input: CreateManuscriptContainer): Promise<ManuscriptNode[]> => ipcRenderer.invoke('manuscript:create-container', input),
    createScene: (input: CreateScene): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:create-scene', input),
    readScene: (scenePath: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:read-scene', scenePath),
    saveScene: (scenePath: string, content: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:save-scene', scenePath, content),
    updateSceneMetadata: (scenePath: string, patch: SceneMetadataPatch, content?: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:update-scene-metadata', scenePath, patch, content),
    listSceneVariants: (scenePath: string): Promise<SceneVariant[]> => ipcRenderer.invoke('manuscript:list-scene-variants', scenePath),
    readSceneVariant: (scenePath: string, variantId: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:read-scene-variant', scenePath, variantId),
    createSceneVariant: (scenePath: string, input: CreateSceneVariant): Promise<SceneVariant[]> => ipcRenderer.invoke('manuscript:create-scene-variant', scenePath, input),
    saveSceneVariant: (scenePath: string, variantId: string, content: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:save-scene-variant', scenePath, variantId, content),
    updateSceneVariantMetadata: (scenePath: string, variantId: string, patch: SceneMetadataPatch, content?: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:update-scene-variant-metadata', scenePath, variantId, patch, content),
    setPreferredSceneVariant: (scenePath: string, variantId: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:set-preferred-scene-variant', scenePath, variantId),
    listSceneSnapshots: (scenePath: string): Promise<SceneSnapshot[]> => ipcRenderer.invoke('manuscript:list-scene-snapshots', scenePath),
    readSceneSnapshot: (scenePath: string, snapshotId: string): Promise<string> => ipcRenderer.invoke('manuscript:read-scene-snapshot', scenePath, snapshotId),
    createSceneVersion: (scenePath: string, content?: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:create-scene-version', scenePath, content),
    restoreSceneSnapshot: (scenePath: string, snapshotId: string): Promise<SceneDocument> => ipcRenderer.invoke('manuscript:restore-scene-snapshot', scenePath, snapshotId)
  },
  relationships: {
    get: (): Promise<RelationshipGraph> => ipcRenderer.invoke('relationships:get'),
    create: (input: CreateRelationship): Promise<Relationship> => ipcRenderer.invoke('relationships:create', input),
    update: (id: string, input: CreateRelationship): Promise<Relationship> => ipcRenderer.invoke('relationships:update', id, input),
    createType: (input: CreateRelationshipType): Promise<import('../shared/workspace').RelationshipType> => ipcRenderer.invoke('relationships:create-type', input),
    deleteType: (id: string): Promise<void> => ipcRenderer.invoke('relationships:delete-type', id),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('relationships:delete', id),
    savePositions: (positions: Record<string, RelationshipGraphPosition>): Promise<RelationshipGraph> => ipcRenderer.invoke('relationships:save-positions', positions),
    saveView: (input: Omit<RelationshipGraphView, 'id'>): Promise<RelationshipGraphView> => ipcRenderer.invoke('relationships:save-view', input),
    deleteView: (id: string): Promise<void> => ipcRenderer.invoke('relationships:delete-view', id),
    export: (): Promise<{ canceled: boolean; path?: string }> => ipcRenderer.invoke('relationships:export'),
    import: (): Promise<RelationshipGraph | null> => ipcRenderer.invoke('relationships:import')
  },
  timeline: {
    get: (): Promise<{ config: TimelineConfig; events: TimelineEvent[]; tracks: TimelineTrack[]; states: StateTransition[] }> => ipcRenderer.invoke('timeline:get'),
    saveConfig: (config: TimelineConfig): Promise<TimelineConfig> => ipcRenderer.invoke('timeline:save-config', config),
    createEvent: (input: CreateTimelineEvent): Promise<TimelineEvent> => ipcRenderer.invoke('timeline:create-event', input),
    updateEvent: (id: string, patch: TimelineEventPatch): Promise<TimelineEvent> => ipcRenderer.invoke('timeline:update-event', id, patch),
    deleteEvent: (id: string): Promise<void> => ipcRenderer.invoke('timeline:delete-event', id),
    createState: (input: CreateStateTransition): Promise<StateTransition> => ipcRenderer.invoke('timeline:create-state', input),
    deleteState: (id: string): Promise<void> => ipcRenderer.invoke('timeline:delete-state', id),
    continuityWarnings: (): Promise<ContinuityWarning[]> => ipcRenderer.invoke('timeline:continuity-warnings')
  },
  workspace: {
    create: (name: string): Promise<WorkspaceSummary | null> => ipcRenderer.invoke('workspace:create', name),
    chooseAndOpen: (): Promise<WorkspaceSummary | null> => ipcRenderer.invoke('workspace:choose-and-open'),
    openRecent: (directory: string): Promise<WorkspaceSummary> => ipcRenderer.invoke('workspace:open-recent', directory),
    listRecents: (): Promise<RecentWorkspace[]> => ipcRenderer.invoke('workspace:list-recents'),
    rescan: (): Promise<WorkspaceRescan> => ipcRenderer.invoke('workspace:rescan'),
    search: (query: string): Promise<GlobalSearchResult[]> => ipcRenderer.invoke('workspace:search', query),
    onChanged: (listener: (change: WorkspaceChange) => void): (() => void) => {
      const subscription = (_event: Electron.IpcRendererEvent, change: WorkspaceChange): void => listener(change)
      ipcRenderer.on('workspace:changed', subscription)
      return () => ipcRenderer.removeListener('workspace:changed', subscription)
    }
  }
}

contextBridge.exposeInMainWorld('worldvilla', worldvilla)

export type WorldVillaApi = typeof worldvilla
