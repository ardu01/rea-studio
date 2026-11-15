export const APP_VERSION = '0.1.0'

export const DOC_LINKS = {
  rea: 'https://github.com/morluto/rea',
  reaNpm: 'https://www.npmjs.com/package/rea-agents',
  reaCli: 'https://github.com/morluto/rea/blob/main/docs/cli.md',
  ghidra: 'https://github.com/NationalSecurityAgency/ghidra',
  ghidraSite: 'https://ghidra-sre.org/',
  ghidraHeadless:
    'https://github.com/NationalSecurityAgency/ghidra/blob/master/Ghidra/RuntimeScripts/support/analyzeHeadlessREADME.md',
  temurin: 'https://adoptium.net/temurin/releases/?version=21',
  radare2: 'https://github.com/radareorg/radare2',
  rizin: 'https://rizin.re/',
  codexCli: 'https://learn.chatgpt.com/docs/non-interactive-mode',
  claudeCli: 'https://code.claude.com/docs/en/headless',
  geminiCli: 'https://github.com/google-gemini/gemini-cli',
  openaiApi: 'https://platform.openai.com/docs/api-reference/chat',
  anthropicApi: 'https://platform.claude.com/docs/en/api/messages',
  xaiApi: 'https://docs.x.ai/docs/guides/streaming',
  geminiApi: 'https://ai.google.dev/api/generate-content',
} as const

export const DOC_LINK_LIST: readonly string[] = Object.values(DOC_LINKS)

export type ToolMaturity = 'implemented' | 'partial' | 'future'

export type DetectionState = 'ready' | 'missing' | 'unsupported' | 'unknown'

export type JobStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed-out'

export type TargetKind = 'file' | 'directory' | 'any' | 'none'

export interface ToolActionInfo {
  id: string
  title: string
  summary: string
  needsTarget: boolean
  targetKind: TargetKind
}

export interface Detection {
  id: string
  name: string
  maturity: ToolMaturity
  state: DetectionState
  detail: string
  resolvedPath?: string
  docsUrl: string
  installHint: string
  verification: string
  actions: ToolActionInfo[]
}

export interface ProviderPublic {
  id: string
  label: string
  transport: 'api' | 'cli'
  model: string
  endpoint?: string
  configured: boolean
  /** Servidor local que no necesita clave (proveedor compatible en localhost). */
  keyless?: boolean
  leavesDevice: boolean
  docsUrl: string
  note: string
}

export interface PublicSettings {
  acceptedUseNotice: boolean
  onboardingComplete: boolean
  workspacePath: string | null
  recentWorkspaces: string[]
  projectPath: string | null
  tools: {
    rea: string
    ghidra: string
    java: string
    radare2: string
    rabin2: string
    rizin: string
    rzBin: string
    codex: string
    claude: string
    gemini: string
  }
  providers: {
    openai: { model: string; endpoint: string }
    anthropic: { model: string; endpoint: string }
    xai: { model: string; endpoint: string }
    gemini: { model: string; endpoint: string }
    compatible: { model: string; endpoint: string }
    codexCli: { model: string }
    claudeCli: { model: string }
    geminiCli: { model: string }
  }
}

export interface AppState {
  version: string
  encryptionAvailable: boolean
  e2e: boolean
  settings: PublicSettings
  providers: ProviderPublic[]
}

export interface JobRecord {
  id: string
  adapterId: string
  actionId: string
  title: string
  targetPath?: string
  timeoutMs: number
  status: JobStatus
  createdAt: string
  finishedAt?: string
  exitCode?: number | null
  error?: string
  executable?: string
  args?: string[]
  artifacts: string[]
}

export interface ArtifactEntry {
  relativePath: string
  bytes: number
  jobId?: string
}

export interface ArtifactPreview {
  relativePath: string
  bytes: number
  truncated: boolean
  binary: boolean
  text: string
}

export interface DisclosureItem {
  name: string
  bytes: number
  sha256: string
  preview: string
}

export interface DisclosureView {
  providerId: string
  destination: string
  leavesDevice: boolean
  promptBytes: number
  promptPreview: string
  items: DisclosureItem[]
  hash: string
  totalBytes: number
}

export interface ProviderCheck {
  id: string
  state: 'not-configured' | 'reachable' | 'present' | 'rejected' | 'error'
  detail: string
  /** models-list is a real HTTP call made only when the user asks. Tests use mocks. */
  evidence: 'not-run' | 'models-list' | 'cli-version' | 'mock-protocol'
}

export type JobEvent =
  | { kind: 'log'; jobId: string; stream: 'stdout' | 'stderr' | 'system'; text: string }
  | { kind: 'status'; job: JobRecord }

export interface ChatLine {
  role: 'user' | 'assistant'
  text: string
  providerId: string
  at: string
}

export type ChatEvent =
  | { kind: 'delta'; requestId: string; text: string }
  | { kind: 'log'; requestId: string; text: string }
  | { kind: 'done'; requestId: string; status: 'succeeded' | 'failed' | 'cancelled'; text: string; error?: string }

export interface ReaBridge {
  getState(): Promise<AppState>
  chooseWorkspace(): Promise<AppState | null>
  chooseFile(): Promise<string | null>
  acceptNotice(workspacePath: string): Promise<AppState>
  updateSettings(patch: SettingsPatch): Promise<AppState>
  detectTools(): Promise<Detection[]>
  setSecret(id: string, value: string): Promise<AppState>
  clearSecret(id: string): Promise<AppState>
  checkProvider(id: string): Promise<ProviderCheck>
  listChat(): Promise<ChatLine[]>
  listJobs(): Promise<JobRecord[]>
  startJob(input: { adapterId: string; actionId: string; targetPath?: string; timeoutSec: number }): Promise<JobRecord>
  cancelJob(id: string): Promise<JobRecord>
  readLog(id: string): Promise<string>
  listArtifacts(): Promise<ArtifactEntry[]>
  readArtifact(relativePath: string): Promise<ArtifactPreview>
  prepareCloud(input: { providerId: string; prompt: string; artifactRels: string[] }): Promise<DisclosureView>
  sendCloud(input: {
    providerId: string
    prompt: string
    artifactRels: string[]
    optIn: boolean
    hash: string
  }): Promise<{ requestId: string }>
  cancelCloud(requestId: string): Promise<void>
  openDocs(url: string): Promise<void>
  onJobEvent(cb: (event: JobEvent) => void): () => void
  onChatEvent(cb: (event: ChatEvent) => void): () => void
  listOllamaModels(): Promise<OllamaListResult>
  pullOllamaModel(model: string): Promise<{ requestId: string }>
  cancelOllamaPull(requestId: string): Promise<void>
  onOllamaEvent(cb: (event: OllamaEvent) => void): () => void
  projectState(): Promise<ProjectView>
  chooseProjectParent(): Promise<string | null>
  chooseProjectFolder(): Promise<string | null>
  createProject(input: { parentDir: string; name: string; template: ProjectTemplateId; references: string[] }): Promise<ProjectView>
  openProject(path: string): Promise<ProjectView>
  closeProject(): Promise<ProjectView>
  projectTree(): Promise<ProjectTree>
  projectRead(relativePath: string): Promise<ProjectFile>
  projectDiff(stepId?: string): Promise<string>
  projectHistory(): Promise<GitStep[]>
  projectUndo(stepId: string): Promise<ProjectView>
  projectResetToStart(): Promise<ProjectView>
  shot?(name: string): Promise<void>
  shotDone?(): Promise<void>
}

export interface SettingsPatch {
  tools?: Partial<PublicSettings['tools']>
  providers?: Partial<{
    openai: Partial<PublicSettings['providers']['openai']>
    anthropic: Partial<PublicSettings['providers']['anthropic']>
    xai: Partial<PublicSettings['providers']['xai']>
    gemini: Partial<PublicSettings['providers']['gemini']>
    compatible: Partial<PublicSettings['providers']['compatible']>
    codexCli: Partial<PublicSettings['providers']['codexCli']>
    claudeCli: Partial<PublicSettings['providers']['claudeCli']>
    geminiCli: Partial<PublicSettings['providers']['geminiCli']>
  }>
}

export interface OllamaModel {
  name: string
  bytes: number | null
  parameterSize: string | null
  quantization: string | null
}

export interface OllamaListResult {
  available: boolean
  base: string | null
  models: OllamaModel[]
  detail: string
}

export interface OllamaSuggestion {
  name: string
  label: string
  file?: string
  bytes: number | null
  uncensored: boolean
  hint: string
}

export interface OllamaProgress {
  status: string
  completed: number | null
  total: number | null
}

export type OllamaEvent =
  | ({ kind: 'progress'; requestId: string; model: string } & OllamaProgress)
  | { kind: 'done'; requestId: string; model: string; status: 'succeeded' | 'failed' | 'cancelled'; error?: string }

export type ProjectTemplateId = 'node' | 'python' | 'dotnet' | 'cmake'

export interface ProjectCommand {
  label: string
  command: string
  args: string[]
}

export interface ProjectInfo {
  root: string
  name: string
  template: ProjectTemplateId
  templateLabel: string
  createdAt: string
  references: string[]
  commands: ProjectCommand[]
}

export interface ProjectView {
  project: ProjectInfo | null
  gitAvailable: boolean
  templates: Array<{ id: ProjectTemplateId; label: string; summary: string }>
}

export interface TreeEntry {
  path: string
  kind: 'file' | 'dir' | 'link'
  depth: number
  bytes?: number
  skipped?: boolean
  status?: string
}

export interface ProjectTree {
  entries: TreeEntry[]
  truncated: boolean
}

export interface ProjectFile {
  relativePath: string
  text: string
  bytes: number
  truncated: boolean
  binary: boolean
}

export interface GitStep {
  id: string
  message: string
  at: string
  author: string
  byRea: boolean
}
