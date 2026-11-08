import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ReaBridge } from '../../src/shared/types'

const bridge: ReaBridge = {
  getState: () => ipcRenderer.invoke('app:state'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  chooseFile: () => ipcRenderer.invoke('dialog:file'),
  acceptNotice: (workspacePath) => ipcRenderer.invoke('app:accept-notice', { path: workspacePath }),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  detectTools: () => ipcRenderer.invoke('tools:detect'),
  setSecret: (id, value) => ipcRenderer.invoke('secrets:set', { id, value }),
  clearSecret: (id) => ipcRenderer.invoke('secrets:clear', { id }),
  checkProvider: (id) => ipcRenderer.invoke('providers:check', { id }),
  listChat: () => ipcRenderer.invoke('chat:history'),
  listJobs: () => ipcRenderer.invoke('jobs:list'),
  startJob: (input) => ipcRenderer.invoke('jobs:start', input),
  cancelJob: (id) => ipcRenderer.invoke('jobs:cancel', { id }),
  readLog: (id) => ipcRenderer.invoke('jobs:log', { id }),
  listArtifacts: () => ipcRenderer.invoke('artifacts:list'),
  readArtifact: (relativePath) => ipcRenderer.invoke('artifacts:read', { relativePath }),
  prepareCloud: (input) => ipcRenderer.invoke('chat:prepare', input),
  sendCloud: (input) => ipcRenderer.invoke('chat:send', input),
  cancelCloud: (requestId) => ipcRenderer.invoke('chat:cancel', { id: requestId }),
  openDocs: (url) => ipcRenderer.invoke('app:open-docs', { url }),
  onJobEvent: (cb) => subscribe('jobs:event', cb),
  onChatEvent: (cb) => subscribe('chat:event', cb),
  shot: (name) => ipcRenderer.invoke('e2e:shot', { name }),
  shotDone: () => ipcRenderer.invoke('e2e:done'),
}

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('reaStudio', bridge)
