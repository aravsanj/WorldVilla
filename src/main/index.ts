import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import path from 'node:path'
import { WorkspaceService } from './workspace-service'
import type { CorkboardLayout, CreateLoreDocument, ManuscriptExportFormat, CreateManuscriptContainer, RenameManuscriptItem, CreateScene, CreateSceneVariant, LorePropertyPatch, LoreSearchFilters, SceneMetadataPatch, TimelineConfig, CreateTimelineEvent, TimelineEventPatch, CreateStateTransition, CreateRelationship, CreateRelationshipType, RelationshipGraphPosition } from '../shared/workspace'

let mainWindow: BrowserWindow | null = null
const workspaceService = new WorkspaceService((change) => {
  mainWindow?.webContents.send('workspace:changed', change)
})

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'WorldVilla',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setName('WorldVilla')

  ipcMain.handle('workspace:create', async (_event, name: string) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Choose a folder for your world',
      buttonLabel: 'Create world here',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return workspaceService.create(result.filePaths[0], name)
  })

  ipcMain.handle('workspace:choose-and-open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open a WorldVilla workspace',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return workspaceService.open(result.filePaths[0])
  })

  ipcMain.handle('workspace:open-recent', (_event, directory: string) => workspaceService.open(directory))
  ipcMain.handle('workspace:list-recents', () => workspaceService.recents())
  ipcMain.handle('workspace:rescan', () => workspaceService.rescan())
  ipcMain.handle('lore:search', (_event, query: string, filters: LoreSearchFilters) => workspaceService.searchLore(query, filters))
  ipcMain.handle('workspace:search', (_event, query: string) => workspaceService.searchGlobal(query))
  ipcMain.handle('relationships:get', () => workspaceService.relationshipGraph())
  ipcMain.handle('relationships:create', (_event, input: CreateRelationship) => workspaceService.createRelationship(input))
  ipcMain.handle('relationships:update', (_event, id: string, input: CreateRelationship) => workspaceService.updateRelationship(id, input))
  ipcMain.handle('relationships:create-type', (_event, input: CreateRelationshipType) => workspaceService.createRelationshipType(input))
  ipcMain.handle('relationships:delete-type', (_event, id: string) => workspaceService.deleteRelationshipType(id))
  ipcMain.handle('relationships:delete', (_event, id: string) => workspaceService.deleteRelationship(id))
  ipcMain.handle('relationships:save-positions', (_event, positions: Record<string, RelationshipGraphPosition>) => workspaceService.saveRelationshipPositions(positions))
  ipcMain.handle('relationships:save-view', (_event, input: Omit<import('../shared/workspace').RelationshipGraphView, 'id'>) => workspaceService.saveRelationshipView(input))
  ipcMain.handle('relationships:delete-view', (_event, id: string) => workspaceService.deleteRelationshipView(id))
  ipcMain.handle('relationships:export', () => workspaceService.exportRelationshipGraph())
  ipcMain.handle('relationships:import', () => workspaceService.importRelationshipGraph())
  ipcMain.handle('timeline:get', () => workspaceService.timeline())
  ipcMain.handle('timeline:save-config', (_event, config: TimelineConfig) => workspaceService.saveTimelineConfig(config))
  ipcMain.handle('timeline:create-event', (_event, input: CreateTimelineEvent) => workspaceService.createTimelineEvent(input))
  ipcMain.handle('timeline:update-event', (_event, id: string, patch: TimelineEventPatch) => workspaceService.updateTimelineEvent(id, patch))
  ipcMain.handle('timeline:delete-event', (_event, id: string) => workspaceService.deleteTimelineEvent(id))
  ipcMain.handle('timeline:create-state', (_event, input: CreateStateTransition) => workspaceService.createStateTransition(input))
  ipcMain.handle('timeline:delete-state', (_event, id: string) => workspaceService.deleteStateTransition(id))
  ipcMain.handle('timeline:continuity-warnings', () => workspaceService.continuityWarnings())
  ipcMain.handle('lore:list', () => workspaceService.listLore())
  ipcMain.handle('lore:list-references', () => workspaceService.listLoreReferences())
  ipcMain.handle('lore:list-backlinks', (_event, documentPath: string) => workspaceService.listBacklinks(documentPath))
  ipcMain.handle('lore:read', (_event, documentPath: string) => workspaceService.readLoreDocument(documentPath))
  ipcMain.handle('lore:save', (_event, documentPath: string, content: string) => workspaceService.saveLoreDocument(documentPath, content))
  ipcMain.handle('lore:update-properties', (_event, documentPath: string, patch: LorePropertyPatch, content?: string) => workspaceService.updateLoreProperties(documentPath, patch, content))
  ipcMain.handle('lore:preview-rename', (_event, documentPath: string, title: string) => workspaceService.previewLoreRename(documentPath, title))
  ipcMain.handle('lore:move', (_event, documentPath: string, destinationFolder: string) => workspaceService.moveLoreDocument(documentPath, destinationFolder))
  ipcMain.handle('lore:delete', (_event, documentPath: string) => workspaceService.deleteLoreDocument(documentPath))
  ipcMain.handle('lore:rename-folder', (_event, folderPath: string, name: string) => workspaceService.renameLoreFolder(folderPath, name))
  ipcMain.handle('lore:move-folder', (_event, folderPath: string, destinationFolder: string) => workspaceService.moveLoreFolder(folderPath, destinationFolder))
  ipcMain.handle('lore:delete-folder', (_event, folderPath: string) => workspaceService.deleteLoreFolder(folderPath))
  ipcMain.handle('lore:create-document', (_event, input: CreateLoreDocument) => workspaceService.createLoreDocument(input))
  ipcMain.handle('lore:create-folder', (_event, parentPath: string, name: string) => workspaceService.createLoreFolder(parentPath, name))
  ipcMain.handle('manuscript:list', () => workspaceService.listManuscript())
  ipcMain.handle('manuscript:export', (_event, path: string, format: ManuscriptExportFormat) => workspaceService.exportManuscript(path, format))
  ipcMain.handle('manuscript:reorder', (_event, parentPath: string, orderedPaths: string[]) => workspaceService.reorderManuscript(parentPath, orderedPaths))
  ipcMain.handle('manuscript:corkboard-layout', () => workspaceService.corkboardLayout())
  ipcMain.handle('manuscript:save-corkboard-layout', (_event, layout: CorkboardLayout) => workspaceService.saveCorkboardLayout(layout))
  ipcMain.handle('manuscript:create-container', (_event, input: CreateManuscriptContainer) => workspaceService.createManuscriptContainer(input))
  ipcMain.handle('manuscript:rename-item', (_event, input: RenameManuscriptItem) => workspaceService.renameManuscriptItem(input))
  ipcMain.handle('manuscript:create-scene', (_event, input: CreateScene) => workspaceService.createScene(input))
  ipcMain.handle('manuscript:read-scene', (_event, scenePath: string) => workspaceService.readScene(scenePath))
  ipcMain.handle('manuscript:save-scene', (_event, scenePath: string, content: string) => workspaceService.saveScene(scenePath, content))
  ipcMain.handle('manuscript:update-scene-metadata', (_event, scenePath: string, patch: SceneMetadataPatch, content?: string) => workspaceService.updateSceneMetadata(scenePath, patch, content))
  ipcMain.handle('manuscript:list-scene-variants', (_event, scenePath: string) => workspaceService.listSceneVariants(scenePath))
  ipcMain.handle('manuscript:read-scene-variant', (_event, scenePath: string, variantId: string) => workspaceService.readSceneVariant(scenePath, variantId))
  ipcMain.handle('manuscript:create-scene-variant', (_event, scenePath: string, input: CreateSceneVariant) => workspaceService.createSceneVariant(scenePath, input))
  ipcMain.handle('manuscript:rename-scene-variant', (_event, scenePath: string, variantId: string, name: string) => workspaceService.renameSceneVariant(scenePath, variantId, name))
  ipcMain.handle('manuscript:save-scene-variant', (_event, scenePath: string, variantId: string, content: string) => workspaceService.saveSceneVariant(scenePath, variantId, content))
  ipcMain.handle('manuscript:update-scene-variant-metadata', (_event, scenePath: string, variantId: string, patch: SceneMetadataPatch, content?: string) => workspaceService.updateSceneVariantMetadata(scenePath, variantId, patch, content))
  ipcMain.handle('manuscript:set-preferred-scene-variant', (_event, scenePath: string, variantId: string) => workspaceService.setPreferredSceneVariant(scenePath, variantId))
  ipcMain.handle('manuscript:list-scene-snapshots', (_event, scenePath: string) => workspaceService.listSceneSnapshots(scenePath))
  ipcMain.handle('manuscript:read-scene-snapshot', (_event, scenePath: string, snapshotId: string) => workspaceService.readSceneSnapshot(scenePath, snapshotId))
  ipcMain.handle('manuscript:create-scene-version', (_event, scenePath: string, content?: string) => workspaceService.createSceneVersion(scenePath, content))
  ipcMain.handle('manuscript:restore-scene-snapshot', (_event, scenePath: string, snapshotId: string) => workspaceService.restoreSceneSnapshot(scenePath, snapshotId))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void workspaceService.close()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
