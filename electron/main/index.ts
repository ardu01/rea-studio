import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, session, shell, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, stat, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'
import { ZodError } from 'zod'
import { createRegistry, listOutputFiles, readTextPreview } from '../../src/core/adapters'
import { assertOptIn, buildDisclosure, contextBody } from '../../src/core/cloud'
import { findOnPath, planLaunch } from '../../src/core/command'
import { allowedEnv, runProcess } from '../../src/core/process'
import { cloudSchema, idSchema, jobStartSchema, pathSchema, relSchema, secretSchema, settingsPatchSchema, urlSchema } from '../../src/core/ipc-schemas'
import { JobManager } from '../../src/core/jobs'
import { assertInside } from '../../src/core/paths'
import { assertProviderId, checkProvider, publicProviders, runModel } from '../../src/core/providers'
import { scrubForLog } from '../../src/core/redact'
import { createSealedStore, type SecretStore } from '../../src/core/secrets'
import { endpointLeavesDevice, ensureWorkspace, loadSettings, normalizeSettings, rememberWorkspace, saveSettings } from '../../src/core/settings'
import { APP_VERSION, DOC_LINK_LIST, type AppState, type ChatLine, type PublicSettings, type SettingsPatch } from '../../src/shared/types'

const ALLOWED_DOCS = new Set(DOC_LINK_LIST)

app.setName('REA Studio')
app.setAppUserModelId('com.reastudio.desktop')

let mainWindow: BrowserWindow | null = null
let settings: PublicSettings
let secrets: SecretStore
let jobs: JobManager
const chats = new Map<string, AbortController>()
let shotDir: string | null = null

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'config.json')
}

function ghidraScripts(): string {
  const candidates = [
    path.join(process.resourcesPath, 'resources', 'ghidra'),
    path.join(process.resourcesPath, 'ghidra'),
    path.join(app.getAppPath(), 'resources', 'ghidra'),
  ]
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'ExportSummary.java'))) return candidate
  }
  return candidates[2] ?? candidates[0]!
}

function requireWorkspace(): string {
  if (!settings.workspacePath) throw new Error('Abre una carpeta de trabajo.')
  return settings.workspacePath
}

async function secretValues(): Promise<string[]> {
  const ids = await secrets.ids()
  const values: string[] = []
  for (const id of ids) {
    const value = await secrets.get(id)
    if (value) values.push(value)
  }
  return values
}

async function toState(): Promise<AppState> {
  const configured = new Set(await secrets.ids())
  for (const id of ['codex-cli', 'claude-cli', 'gemini-cli'] as const) {
    const key = id === 'codex-cli' ? 'codex' : id === 'claude-cli' ? 'claude' : 'gemini'
    const custom = settings.tools[key].trim()
    if (custom || findOnPath(key === 'codex' ? 'codex' : key, process.env.PATH ?? '', process.platform)) configured.add(id)
  }
  let encryptionAvailable = false
  try {
    encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    encryptionAvailable = false
  }
  return {
    version: APP_VERSION,
    encryptionAvailable,
    e2e: process.env.REA_STUDIO_E2E === '1',
    settings,
    providers: publicProviders(settings, configured),
  }
}

function mergePatch(current: PublicSettings, patch: SettingsPatch): PublicSettings {
  return normalizeSettings({
    ...current,
    tools: { ...current.tools, ...patch.tools },
    providers: {
      openai: { ...current.providers.openai, ...patch.providers?.openai },
      anthropic: { ...current.providers.anthropic, ...patch.providers?.anthropic },
      xai: { ...current.providers.xai, ...patch.providers?.xai },
      gemini: { ...current.providers.gemini, ...patch.providers?.gemini },
      compatible: { ...current.providers.compatible, ...patch.providers?.compatible },
      codexCli: { ...current.providers.codexCli, ...patch.providers?.codexCli },
      claudeCli: { ...current.providers.claudeCli, ...patch.providers?.claudeCli },
      geminiCli: { ...current.providers.geminiCli, ...patch.providers?.geminiCli },
    },
  })
}

function assertSender(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  const allowed = url.startsWith('file://') || (dev !== undefined && (url.startsWith(dev) || url.startsWith('http://127.0.0.1:43123') || url.startsWith('http://localhost:43123')))
  if (!allowed) throw new Error('Origen IPC rechazado.')
}

function handle(channel: string, fn: (payload: unknown) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      assertSender(event)
      return await fn(payload)
    } catch (error) {
      if (error instanceof ZodError) throw new Error('Los datos enviados no son válidos.')
      throw new Error(error instanceof Error ? error.message : 'Error')
    }
  })
}

async function openWorkspace(dir: string): Promise<AppState> {
  const info = await stat(dir)
  if (!info.isDirectory()) throw new Error('Elige una carpeta.')
  await ensureWorkspace(dir, path.basename(dir))
  settings = rememberWorkspace(settings, dir)
  await saveSettings(settingsFile(), settings)
  return toState()
}

function destinationFor(providerId: string): { destination: string; leavesDevice: boolean } {
  const id = assertProviderId(providerId)
  if (id === 'openai') return { destination: settings.providers.openai.endpoint, leavesDevice: endpointLeavesDevice(settings.providers.openai.endpoint) }
  if (id === 'anthropic') return { destination: settings.providers.anthropic.endpoint, leavesDevice: endpointLeavesDevice(settings.providers.anthropic.endpoint) }
  if (id === 'xai') return { destination: settings.providers.xai.endpoint, leavesDevice: endpointLeavesDevice(settings.providers.xai.endpoint) }
  if (id === 'gemini') return { destination: settings.providers.gemini.endpoint, leavesDevice: endpointLeavesDevice(settings.providers.gemini.endpoint) }
  if (id === 'compatible') return { destination: settings.providers.compatible.endpoint, leavesDevice: endpointLeavesDevice(settings.providers.compatible.endpoint) }
  const label = id === 'codex-cli' ? 'Codex CLI (sesión local, el texto sale hacia OpenAI)' : id === 'claude-cli' ? 'Claude Code (sesión local, el texto sale hacia Anthropic)' : 'Gemini CLI (sesión local, el texto sale hacia Google)'
  return { destination: label, leavesDevice: true }
}

async function loadContext(rels: string[]): Promise<Array<{ name: string; text: string }>> {
  const workspace = requireWorkspace()
  const root = await realpath(workspace)
  const items = []
  for (const rel of rels) {
    const full = assertInside(root, rel)
    const real = await realpath(full)
    assertInside(root, real)
    const preview = await readTextPreview(real)
    if (preview.binary) throw new Error(`${rel} parece binario. Adjunta una salida de texto.`)
    items.push({ name: rel, text: preview.text })
  }
  return items
}

async function appendChat(line: ChatLine): Promise<void> {
  const file = path.join(requireWorkspace(), 'chat.jsonl')
  const secretsNow = await secretValues()
  const safe = { ...line, text: scrubForLog(line.text, secretsNow) }
  await appendFile(file, `${JSON.stringify(safe)}\n`, 'utf8')
}

function registerIpc(): void {
  handle('app:state', async () => toState())
  handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Carpeta de trabajo',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return openWorkspace(result.filePaths[0])
  })
  handle('dialog:file', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Archivo a examinar',
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })
  handle('app:accept-notice', async (payload) => {
    const { path: workspacePath } = pathSchema.parse(payload)
    await openWorkspace(workspacePath)
    settings = normalizeSettings({ ...settings, acceptedUseNotice: true, onboardingComplete: true, workspacePath })
    await saveSettings(settingsFile(), settings)
    return toState()
  })
  handle('settings:update', async (payload) => {
    const patch = settingsPatchSchema.parse(payload) as SettingsPatch
    settings = mergePatch(settings, patch)
    await saveSettings(settingsFile(), settings)
    return toState()
  })
  handle('tools:detect', async () => {
    const ctx = {
      platform: process.platform,
      pathEnv: process.env.PATH ?? '',
      configured: settings.tools,
      resourcesDir: ghidraScripts(),
      exists: existsSync,
      runVersion: async (executable: string, args: string[]) => {
        const launch = planLaunch(executable, args)
        const result = await runProcess({
          command: launch.command,
          args: launch.args,
          cwd: app.getPath('temp'),
          timeoutMs: 15000,
          env: allowedEnv(),
        })
        return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }
      },
    }
    const detections = []
    for (const adapter of createRegistry()) detections.push(await adapter.detect(ctx))
    return detections
  })
  handle('secrets:set', async (payload) => {
    const body = secretSchema.parse(payload)
    if (!body.value) throw new Error('La clave está vacía.')
    await secrets.set(body.id, body.value)
    return toState()
  })
  handle('secrets:clear', async (payload) => {
    const body = secretSchema.parse(payload)
    await secrets.delete(body.id)
    return toState()
  })
  handle('providers:check', async (payload) => {
    const { id } = idSchema.parse(payload)
    const providerId = assertProviderId(id)
    const apiKey = providerId.endsWith('-cli') ? null : await secrets.get(providerId)
    return checkProvider({ id: providerId, settings, apiKey })
  })
  handle('jobs:list', async () => jobs.list())
  handle('jobs:start', async (payload) => {
    const body = jobStartSchema.parse(payload)
    return jobs.start({
      adapterId: body.adapterId,
      actionId: body.actionId,
      targetPath: body.targetPath,
      timeoutMs: body.timeoutSec * 1000,
    })
  })
  handle('jobs:cancel', async (payload) => {
    const { id } = idSchema.parse(payload)
    jobs.cancel(id)
    return jobs.wait(id)
  })
  handle('jobs:log', async (payload) => {
    const { id } = idSchema.parse(payload)
    return jobs.readLog(id)
  })
  handle('artifacts:list', async () => {
    const workspace = requireWorkspace()
    const root = path.join(workspace, 'jobs')
    let names: string[] = []
    try {
      names = await (await import('node:fs/promises')).readdir(root)
    } catch {
      return []
    }
    const entries = []
    for (const name of names) {
      const files = await listOutputFiles(path.join(root, name))
      for (const file of files) {
        const info = await stat(file)
        entries.push({ relativePath: path.relative(workspace, file), bytes: info.size, jobId: name })
      }
    }
    return entries
  })
  handle('artifacts:read', async (payload) => {
    const { relativePath } = relSchema.parse(payload)
    const workspace = await realpath(requireWorkspace())
    const full = assertInside(workspace, relativePath)
    const real = await realpath(full)
    assertInside(workspace, real)
    const preview = await readTextPreview(real)
    return { relativePath, ...preview }
  })
  handle('chat:history', async () => {
    try {
      const raw = await readFile(path.join(requireWorkspace(), 'chat.jsonl'), 'utf8')
      return raw
        .split('\n')
        .filter(Boolean)
        .slice(-40)
        .map((line) => JSON.parse(line) as ChatLine)
    } catch {
      return []
    }
  })
  handle('chat:prepare', async (payload) => {
    const body = cloudSchema.parse(payload)
    const place = destinationFor(body.providerId)
    const artifacts = await loadContext(body.artifactRels)
    return buildDisclosure({
      providerId: body.providerId,
      destination: place.destination,
      leavesDevice: place.leavesDevice,
      prompt: body.prompt,
      artifacts,
    })
  })
  handle('chat:send', async (payload) => {
    const body = cloudSchema.parse(payload)
    if (body.optIn !== true || !body.hash) throw new Error('Confirma el envío antes de continuar.')
    const place = destinationFor(body.providerId)
    const artifacts = await loadContext(body.artifactRels)
    const disclosure = buildDisclosure({
      providerId: body.providerId,
      destination: place.destination,
      leavesDevice: place.leavesDevice,
      prompt: body.prompt,
      artifacts,
    })
    assertOptIn(body.optIn, body.hash, disclosure.hash)
    const requestId = `chat-${crypto.randomUUID()}`
    const controller = new AbortController()
    chats.set(requestId, controller)
    const context = contextBody(disclosure.items, artifacts)
    const workspace = requireWorkspace()
    const outputFile = path.join(workspace, 'jobs', `${requestId}-codex.txt`)
    await mkdir(path.join(workspace, 'jobs'), { recursive: true })
    const known = await secretValues()
    void appendChat({ role: 'user', text: body.prompt, providerId: body.providerId, at: new Date().toISOString() })
    void (async () => {
      try {
        const text = await runModel({
          id: assertProviderId(body.providerId),
          settings,
          apiKey: body.providerId.endsWith('-cli') ? null : await secrets.get(body.providerId),
          prompt: body.prompt,
          context,
          cwd: app.getPath('temp'),
          outputFile,
          timeoutMs: 120000,
          signal: controller.signal,
          onDelta: (delta) => mainWindow?.webContents.send('chat:event', { kind: 'delta', requestId, text: delta }),
          onLog: (line) => mainWindow?.webContents.send('chat:event', { kind: 'log', requestId, text: scrubForLog(line, known) }),
        })
        const safe = scrubForLog(text, await secretValues())
        await appendChat({ role: 'assistant', text: safe, providerId: body.providerId, at: new Date().toISOString() })
        mainWindow?.webContents.send('chat:event', { kind: 'done', requestId, status: 'succeeded', text: safe })
      } catch (error) {
        const message = scrubForLog(error instanceof Error ? error.message : 'Error', await secretValues())
        const cancelled = message === 'Cancelado.' || controller.signal.aborted
        mainWindow?.webContents.send('chat:event', {
          kind: 'done',
          requestId,
          status: cancelled ? 'cancelled' : 'failed',
          text: '',
          error: cancelled ? 'Cancelado.' : message,
        })
      } finally {
        chats.delete(requestId)
      }
    })()
    return { requestId }
  })
  handle('chat:cancel', async (payload) => {
    const { id } = idSchema.parse(payload)
    chats.get(id)?.abort()
  })
  handle('app:open-docs', async (payload) => {
    const { url } = urlSchema.parse(payload)
    if (!ALLOWED_DOCS.has(url)) throw new Error('Enlace no permitido.')
    await shell.openExternal(url)
  })
  handle('e2e:shot', async (payload) => {
    if (!shotDir || !mainWindow) return
    const name = zName(payload)
    const image = await mainWindow.webContents.capturePage()
    await writeFile(path.join(shotDir, `${name}.png`), image.toPNG())
  })
  handle('e2e:done', async () => {
    if (process.env.REA_STUDIO_E2E === '1') app.quit()
  })
}

function zName(payload: unknown): string {
  const name = (payload as { name?: string } | null)?.name ?? 'vista'
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('Nombre de captura inválido.')
  return name
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir carpeta…',
          click: () => {
            void (async () => {
              const next = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
              if (next.filePaths[0]) {
                await openWorkspace(next.filePaths[0])
                mainWindow?.webContents.reload()
              }
            })()
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamaño real' },
        { role: 'zoomIn', label: 'Ampliar' },
        { role: 'zoomOut', label: 'Reducir' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
    {
      label: 'Ayuda',
      submenu: [{ label: 'Documentación de REA', click: () => void shell.openExternal('https://github.com/morluto/rea') }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'REA Studio',
    backgroundColor: '#f5f5f7',
    autoHideMenuBar: false,
    webPreferences: {
      preload: existsSync(path.join(__dirname, '../preload/index.mjs'))
        ? path.join(__dirname, '../preload/index.mjs')
        : path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    const ok = url.startsWith('file://') || (dev !== undefined && url.startsWith(dev))
    if (!ok) event.preventDefault()
  })
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`No se cargó la interfaz: ${code} ${description} ${url}`)
  })
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function installCsp(): void {
  const dev = Boolean(process.env.ELECTRON_RENDERER_URL)
  const policy = dev
    ? "default-src 'self' http://127.0.0.1:43123 http://localhost:43123; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:43123 http://localhost:43123; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws://127.0.0.1:43123 ws://localhost:43123 http://127.0.0.1:43123 http://localhost:43123"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'"
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
}

async function seedE2E(): Promise<void> {
  if (process.env.REA_STUDIO_E2E !== '1') return
  const workspace = process.env.REA_STUDIO_WORKSPACE
  if (!workspace) return
  await openWorkspace(workspace)
  settings = normalizeSettings({ ...settings, acceptedUseNotice: true, onboardingComplete: true, workspacePath: workspace })
  await saveSettings(settingsFile(), settings)
  const sample = process.env.REA_STUDIO_SAMPLE
  if (!sample) return
  const existing = await jobs.list()
  if (existing.length > 0) return
  const started = await jobs.start({ adapterId: 'strings', actionId: 'extract', targetPath: sample, timeoutMs: 20000 })
  await jobs.wait(started.id)
  const meta = await jobs.start({ adapterId: 'metadata', actionId: 'inspect', targetPath: sample, timeoutMs: 20000 })
  await jobs.wait(meta.id)
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.whenReady().then(async () => {
  settings = await loadSettings(settingsFile())
  const secretsPath = path.join(app.getPath('userData'), 'secrets.bin')
  let encryptionAvailable = false
  try {
    encryptionAvailable = await safeStorage.isAsyncEncryptionAvailable()
  } catch {
    encryptionAvailable = false
  }
  secrets = createSealedStore(
    {
      async read() {
        try {
          return await readFile(secretsPath)
        } catch {
          return null
        }
      },
      async write(buf) {
        await mkdir(path.dirname(secretsPath), { recursive: true })
        await writeFile(secretsPath, buf, { mode: 0o600 })
      },
    },
    {
      available: encryptionAvailable,
      encrypt: encryptionAvailable ? (plain) => safeStorage.encryptString(plain) : undefined,
      decrypt: encryptionAvailable ? (payload) => safeStorage.decryptString(payload) : undefined,
    },
  )
  jobs = new JobManager({
    workspace: requireWorkspace,
    configured: () => settings.tools,
    resourcesDir: ghidraScripts(),
    scrub: async () => {
      const values = await secretValues()
      return (text: string) => scrubForLog(text, values)
    },
    emit: (event) => mainWindow?.webContents.send('jobs:event', event),
  })
  shotDir = process.env.REA_STUDIO_SCREENSHOT_DIR ?? null
  if (shotDir) await mkdir(shotDir, { recursive: true })
  installCsp()
  buildMenu()
  registerIpc()
  await seedE2E()
  createWindow()
  if (process.env.REA_STUDIO_SMOKE === '1') {
    const out = process.env.REA_STUDIO_SMOKE_OUT
    if (out) {
      await mkdir(path.dirname(out), { recursive: true })
      await writeFile(out, `ready ${APP_VERSION}\n`, { encoding: 'utf8', mode: 0o600 })
    }
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
