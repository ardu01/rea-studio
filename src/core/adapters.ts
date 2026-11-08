import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, open, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { findOnPath } from './command.js'
import { assertAbsoluteUserPath } from './paths.js'
import type { Detection, TargetKind, ToolActionInfo, ToolMaturity } from '../shared/types.js'
import { DOC_LINKS } from '../shared/types.js'

export interface AdapterContext {
  platform: NodeJS.Platform
  pathEnv: string
  configured: Record<string, string>
  resourcesDir: string
  exists: (file: string) => boolean
  runVersion: (executable: string, args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number | null }>
}

export interface PlanInput {
  targetPath?: string
  jobDir: string
  outputDir: string
  timeoutMs: number
  resourcesDir: string
  configured: Record<string, string>
  platform: NodeJS.Platform
  pathEnv: string
}

export interface ProcessPlan {
  kind: 'process'
  executable: string
  args: string[]
  cwd: string
  stdin?: string
}

export interface LocalRunContext {
  outputDir: string
  targetPath?: string
  signal: AbortSignal
  log: (line: string) => void
}

export interface LocalPlan {
  kind: 'local'
  run: (ctx: LocalRunContext) => Promise<{ summary: string; files: string[] }>
}

export interface ToolAdapter {
  id: string
  name: string
  maturity: ToolMaturity
  verification: string
  docsUrl: string
  installHint: string
  actions: ToolActionInfo[]
  detect: (ctx: AdapterContext) => Promise<Detection>
  plan: (actionId: string, input: PlanInput) => ProcessPlan | LocalPlan
}

const FUTURE: Array<{ id: string; name: string; binary: string; docsUrl: string; hint: string }> = [
  {
    id: 'ida',
    name: 'IDA Pro',
    binary: 'ida64',
    docsUrl: 'https://hex-rays.com/ida-pro',
    hint: 'IDA no tiene adaptador en v0.1.0. No se lanzará aunque esté instalado.',
  },
  {
    id: 'binary-ninja',
    name: 'Binary Ninja',
    binary: 'binaryninja',
    docsUrl: 'https://binary.ninja/',
    hint: 'Binary Ninja queda como complemento futuro. v0.1.0 no lo ejecuta.',
  },
  {
    id: 'hopper',
    name: 'Hopper',
    binary: 'hopper',
    docsUrl: 'https://www.hopperapp.com/',
    hint: 'Hopper queda como complemento futuro. v0.1.0 no lo ejecuta.',
  },
  {
    id: 'jadx',
    name: 'JADX',
    binary: 'jadx',
    docsUrl: 'https://github.com/skylot/jadx',
    hint: 'JADX queda como complemento futuro. v0.1.0 no lo ejecuta.',
  },
]

function action(
  id: string,
  title: string,
  summary: string,
  needsTarget: boolean,
  targetKind: TargetKind,
): ToolActionInfo {
  return { id, title, summary, needsTarget, targetKind }
}

function resolveConfigured(ctx: AdapterContext, key: string, basename: string): string | null {
  const configured = ctx.configured[key]?.trim()
  if (configured) {
    const abs = assertAbsoluteUserPath(configured, ctx.platform)
    return ctx.exists(abs) ? abs : null
  }
  return findOnPath(basename, ctx.pathEnv, ctx.platform)
}

async function versionOf(
  ctx: AdapterContext,
  executable: string,
  args: string[] = ['--version'],
): Promise<string> {
  try {
    const result = await ctx.runVersion(executable, args)
    const text = `${result.stdout}\n${result.stderr}`.trim().split('\n')[0] ?? ''
    return text.slice(0, 180) || 'sin versión'
  } catch (error) {
    return `no se pudo ejecutar: ${(error as Error).message}`
  }
}

const REA_ACTIONS: ToolActionInfo[] = [
  action(
    'analyze-javascript',
    'Analizar aplicación JavaScript',
    'rea analyze-javascript-application PATH --integrity-policy record-and-continue --json. Análisis estático de un directorio o ASAR. No ejecuta la aplicación.',
    true,
    'any',
  ),
  action(
    'analyze',
    'Analizar (proveedor automático)',
    'rea analyze PATH --json. En directorios y ASAR, REA usa el análisis estático si no se pasa --provider. REA Studio no añade flags de instrumentación.',
    true,
    'any',
  ),
  action('providers', 'Listar proveedores', 'rea providers --json', false, 'none'),
  action('capabilities', 'Listar capacidades', 'rea capabilities --json', false, 'none'),
  action('doctor', 'Diagnóstico', 'rea doctor --json. Lectura del entorno; no cambia la configuración.', false, 'none'),
  action('inspect-go', 'Inspeccionar binario Go', 'rea inspect-go-binary PATH --json', true, 'file'),
  action('inspect-pe-imports', 'Importaciones PE', 'rea inspect-pe-imports PATH --json', true, 'file'),
  action('inspect-pe-certificates', 'Certificados PE', 'rea inspect-pe-certificates PATH --json', true, 'file'),
  action('inspect-elf-notes', 'Notas ELF', 'rea inspect-elf-notes PATH --json', true, 'file'),
  action('inspect-rust', 'Inspeccionar binario Rust', 'rea inspect-rust-binary PATH --json', true, 'file'),
  action('inspect-managed', 'Ensamblado .NET', 'rea inspect-managed-artifact PATH --json', true, 'file'),
  action('inspect-python-pyc', 'Bytecode Python', 'rea inspect-python-pyc PATH --json', true, 'file'),
]

const REA_ARGV: Record<string, (target?: string) => string[]> = {
  'analyze-javascript': (target) => [
    'analyze-javascript-application',
    target ?? '',
    '--integrity-policy',
    'record-and-continue',
    '--json',
  ],
  analyze: (target) => ['analyze', target ?? '', '--json'],
  providers: () => ['providers', '--json'],
  capabilities: () => ['capabilities', '--json'],
  doctor: () => ['doctor', '--json'],
  'inspect-go': (target) => ['inspect-go-binary', target ?? '', '--json'],
  'inspect-pe-imports': (target) => ['inspect-pe-imports', target ?? '', '--json'],
  'inspect-pe-certificates': (target) => ['inspect-pe-certificates', target ?? '', '--json'],
  'inspect-elf-notes': (target) => ['inspect-elf-notes', target ?? '', '--json'],
  'inspect-rust': (target) => ['inspect-rust-binary', target ?? '', '--json'],
  'inspect-managed': (target) => ['inspect-managed-artifact', target ?? '', '--json'],
  'inspect-python-pyc': (target) => ['inspect-python-pyc', target ?? '', '--json'],
}

export function reaArgv(actionId: string, target?: string): string[] {
  const build = REA_ARGV[actionId]
  if (!build) throw new Error('Acción de REA desconocida.')
  const needsTarget = REA_ACTIONS.find((item) => item.id === actionId)?.needsTarget
  if (needsTarget && !target) throw new Error('Falta el objetivo.')
  return needsTarget ? build(target) : build()
}

export const reaAdapter: ToolAdapter = {
  id: 'rea',
  name: 'REA',
  maturity: 'implemented',
  verification: 'Comandos documentados. Las pruebas lanzan un ejecutable sustituto, no el paquete rea-agents.',
  docsUrl: DOC_LINKS.reaCli,
  installHint: 'npm install --global rea-agents   ·   https://github.com/morluto/rea',
  actions: REA_ACTIONS,
  async detect(ctx) {
    const resolved = resolveConfigured(ctx, 'rea', 'rea')
    if (!resolved) {
      return baseDetection(this, 'missing', 'No configurado. No está rea en PATH ni en la ruta indicada.')
    }
    const version = await versionOf(ctx, resolved, ['--version'])
    return baseDetection(this, 'ready', `Encontrado. ${version}`, resolved)
  },
  plan(actionId, input) {
    const executable = requiredTool(input, 'rea', 'rea')
    const spec = REA_ACTIONS.find((item) => item.id === actionId)
    if (!spec) throw new Error('Acción de REA desconocida.')
    if (spec.needsTarget && !input.targetPath) throw new Error('Esta acción necesita un archivo o una carpeta.')
    return {
      kind: 'process',
      executable,
      args: reaArgv(actionId, input.targetPath),
      cwd: input.jobDir,
    }
  },
}

export function parseJavaVersion(text: string): { version: string; major: number | null } | null {
  const quoted = text.match(/version "(1\.\d+(?:\.\d+)*|\d+[^"]*)"/)
  const plain = text.match(/\b(?:openjdk|java)\s+(\d+\S*)/i)
  const version = quoted?.[1] ?? plain?.[1]
  if (!version) return null
  let major: number | null
  if (version.startsWith('1.')) major = Number(version.split('.')[1])
  else major = Number(version.split(/[.+]/)[0])
  if (!Number.isFinite(major)) major = null
  return { version, major }
}

export function resolveGhidraLauncher(configuredOrFound: string, platform: NodeJS.Platform): string {
  const base = path.basename(configuredOrFound).toLowerCase()
  if (base === 'analyzeheadless' || base === 'analyzeheadless.bat') return configuredOrFound
  const file = platform === 'win32' ? 'analyzeHeadless.bat' : 'analyzeHeadless'
  return path.join(configuredOrFound, 'support', file)
}

export function ghidraArgv(input: {
  projectDir: string
  target: string
  scriptDir: string
  summaryPath: string
  logPath: string
  timeoutSec: number
}): string[] {
  return [
    input.projectDir,
    'rea-studio',
    '-import',
    input.target,
    '-scriptPath',
    input.scriptDir,
    '-postScript',
    'ExportSummary.java',
    input.summaryPath,
    '-analysisTimeoutPerFile',
    String(input.timeoutSec),
    '-deleteProject',
    '-log',
    input.logPath,
  ]
}

export const ghidraAdapter: ToolAdapter = {
  id: 'ghidra',
  name: 'Ghidra headless',
  maturity: 'implemented',
  verification: 'analyzeHeadless con ExportSummary.java propio. Las pruebas usan un lanzador sustituto.',
  docsUrl: DOC_LINKS.ghidraHeadless,
  installHint: 'Descomprime la release oficial y elige la carpeta de Ghidra. Hace falta JDK 21 para Ghidra 11.',
  actions: [
    action(
      'import-summary',
      'Importar y resumir',
      'analyzeHeadless -import con un post-script que escribe nombre, lenguaje, base y hasta 200 funciones. No ejecuta el binario. El proyecto de Ghidra se borra al terminar.',
      true,
      'file',
    ),
  ],
  async detect(ctx) {
    const configured = ctx.configured.ghidra?.trim()
    const found = configured
      ? resolveGhidraLauncher(assertAbsoluteUserPath(configured, ctx.platform), ctx.platform)
      : findGhidraOnPath(ctx)
    if (!found || !ctx.exists(found)) {
      return baseDetection(this, 'missing', 'No configurado. Indica la carpeta de Ghidra o support/analyzeHeadless.')
    }
    const java = resolveConfigured(ctx, 'java', 'java')
    if (!java) {
      return baseDetection(this, 'missing', `Ghidra está en ${found}, pero no hay java en PATH.`, found)
    }
    const probed = await ctx.runVersion(java, ['-version'])
    const parsed = parseJavaVersion(`${probed.stderr}\n${probed.stdout}`)
    const javaNote = parsed
      ? `Java ${parsed.version}`
      : 'Java responde, pero no se reconoció la versión'
    const jdk =
      parsed?.major !== null && parsed && parsed.major < 21
        ? `${javaNote}. Ghidra 11.x pide JDK 21; esta versión puede fallar.`
        : javaNote
    return baseDetection(this, 'ready', `Lanzador ${found}. ${jdk}.`, found)
  },
  plan(actionId, input) {
    if (actionId !== 'import-summary') throw new Error('Acción de Ghidra desconocida.')
    if (!input.targetPath) throw new Error('Ghidra necesita un archivo.')
    const launcher = ghidraLauncher(input)
    if (!existsSync(launcher)) throw new Error('No existe el lanzador de Ghidra indicado.')
    const timeoutSec = Math.max(1, Math.min(3600, Math.round(input.timeoutMs / 1000)))
    return {
      kind: 'process',
      executable: launcher,
      args: ghidraArgv({
        projectDir: path.join(input.jobDir, 'ghidra-project'),
        target: input.targetPath,
        scriptDir: input.resourcesDir,
        summaryPath: path.join(input.outputDir, 'ghidra-summary.json'),
        logPath: path.join(input.outputDir, 'ghidra.log'),
        timeoutSec,
      }),
      cwd: input.jobDir,
    }
  },
}

function findGhidraOnPath(ctx: AdapterContext): string | null {
  const envDir = process.env.GHIDRA_INSTALL_DIR
  if (!envDir) return null
  const launcher = resolveGhidraLauncher(envDir, ctx.platform)
  return ctx.exists(launcher) ? launcher : null
}

export function ghidraLauncher(input: PlanInput): string {
  const configured = input.configured.ghidra?.trim()
  if (configured) return resolveGhidraLauncher(assertAbsoluteUserPath(configured, input.platform), input.platform)
  const envDir = process.env.GHIDRA_INSTALL_DIR
  if (envDir) return resolveGhidraLauncher(envDir, input.platform)
  throw new Error('No está configurado el lanzador de Ghidra.')
}

export const radareAdapter: ToolAdapter = {
  id: 'radare2',
  name: 'radare2',
  maturity: 'implemented',
  verification: 'rabin2 y r2 -c con un script fijo (aa; afl; q). No se abre el depurador.',
  docsUrl: DOC_LINKS.radare2,
  installHint: 'Instala radare2 desde la release oficial. REA Studio busca r2 y rabin2.',
  actions: [
    action('info', 'Información del binario', 'rabin2 -I -i -E -S -j. Metadatos, imports, exports y secciones en JSON.', true, 'file'),
    action(
      'aa',
      'Análisis estático breve',
      'r2 -q -c "aa; afl; q". Análisis estático aa y lista de funciones. No usa ood ni dc.',
      true,
      'file',
    ),
  ],
  async detect(ctx) {
    const r2 = resolveConfigured(ctx, 'radare2', 'r2')
    const rabin = resolveConfigured(ctx, 'rabin2', 'rabin2')
    if (!r2 && !rabin) return baseDetection(this, 'missing', 'No configurado. No están r2 ni rabin2.')
    const bits = [r2 ? `r2: ${await versionOf(ctx, r2)}` : 'r2 ausente', rabin ? 'rabin2 presente' : 'rabin2 ausente']
    return baseDetection(this, 'ready', bits.join('. '), r2 ?? rabin ?? undefined)
  },
  plan(actionId, input) {
    if (!input.targetPath) throw new Error('radare2 necesita un archivo.')
    if (actionId === 'info') {
      return {
        kind: 'process',
        executable: requiredTool(input, 'rabin2', 'rabin2'),
        args: ['-I', '-i', '-E', '-S', '-j', input.targetPath],
        cwd: input.jobDir,
      }
    }
    if (actionId === 'aa') {
      return {
        kind: 'process',
        executable: requiredTool(input, 'radare2', 'r2'),
        args: ['-q', '-e', 'scr.color=0', '-e', 'anal.hasnext=false', '-c', 'aa; afl; q', input.targetPath],
        cwd: input.jobDir,
      }
    }
    throw new Error('Acción de radare2 desconocida.')
  },
}

export const rizinAdapter: ToolAdapter = {
  id: 'rizin',
  name: 'Rizin',
  maturity: 'implemented',
  verification: 'rz-bin y rizin -c con script fijo. Sin depuración.',
  docsUrl: DOC_LINKS.rizin,
  installHint: 'Instala Rizin desde https://rizin.re/. REA Studio busca rizin y rz-bin.',
  actions: [
    action('info', 'Información del binario', 'rz-bin -I -i -E -S -j', true, 'file'),
    action('aa', 'Análisis estático breve', 'rizin -q -c "aa; afl; q". No ejecuta el binario.', true, 'file'),
  ],
  async detect(ctx) {
    const rizin = resolveConfigured(ctx, 'rizin', 'rizin')
    const rzBin = resolveConfigured(ctx, 'rzBin', 'rz-bin')
    if (!rizin && !rzBin) return baseDetection(this, 'missing', 'No configurado. No están rizin ni rz-bin.')
    const note = rizin ? await versionOf(ctx, rizin) : 'sin rizin'
    return baseDetection(this, 'ready', `${note}. ${rzBin ? 'rz-bin presente' : 'rz-bin ausente'}.`, rizin ?? rzBin ?? undefined)
  },
  plan(actionId, input) {
    if (!input.targetPath) throw new Error('Rizin necesita un archivo.')
    if (actionId === 'info') {
      return {
        kind: 'process',
        executable: requiredTool(input, 'rzBin', 'rz-bin'),
        args: ['-I', '-i', '-E', '-S', '-j', input.targetPath],
        cwd: input.jobDir,
      }
    }
    if (actionId === 'aa') {
      return {
        kind: 'process',
        executable: requiredTool(input, 'rizin', 'rizin'),
        args: ['-q', '-e', 'scr.color=0', '-c', 'aa; afl; q', input.targetPath],
        cwd: input.jobDir,
      }
    }
    throw new Error('Acción de Rizin desconocida.')
  },
}

const MAX_SCAN = 64 * 1024 * 1024
const MAX_STRINGS = 8000

export async function extractStrings(file: string, signal: AbortSignal): Promise<string[]> {
  const handle = await open(file, 'r')
  const found: string[] = []
  try {
    const info = await handle.stat()
    const total = Math.min(info.size, MAX_SCAN)
    const buf = Buffer.alloc(total)
    if (total > 0) await handle.read(buf, 0, total, 0)
    if (signal.aborted) throw new Error('Cancelado.')
    const push = (value: string) => {
      if (value.length >= 4 && found.length < MAX_STRINGS) found.push(value)
    }
    let ascii = ''
    for (const byte of buf) {
      if (byte >= 32 && byte <= 126) ascii += String.fromCharCode(byte)
      else {
        push(ascii)
        ascii = ''
      }
    }
    push(ascii)
    let utf16 = ''
    for (let index = 0; index + 1 < buf.length; index += 2) {
      const low = buf[index] ?? 0
      const high = buf[index + 1] ?? 0
      if (high === 0 && low >= 32 && low <= 126) utf16 += String.fromCharCode(low)
      else {
        push(utf16)
        utf16 = ''
      }
    }
    push(utf16)
  } finally {
    await handle.close()
  }
  return [...new Set(found)]
}

export async function describeFile(file: string): Promise<Record<string, unknown>> {
  const st = await stat(file)
  const head = Buffer.alloc(Math.min(16, st.size))
  if (st.size > 0) {
    const handle = await open(file, 'r')
    try {
      await handle.read(head, 0, head.length, 0)
    } finally {
      await handle.close()
    }
  }
  const hash = createHash('sha256')
  const handle = await open(file, 'r')
  try {
    const chunk = Buffer.alloc(1024 * 1024)
    let offset = 0
    while (offset < st.size) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset)
      if (!bytesRead) break
      hash.update(chunk.subarray(0, bytesRead))
      offset += bytesRead
    }
  } finally {
    await handle.close()
  }
  return {
    path: file,
    bytes: st.size,
    modifiedAt: st.mtime.toISOString(),
    sha256: hash.digest('hex'),
    magicHex: head.toString('hex'),
    kind: magicKind(head),
  }
}

export function magicKind(head: Buffer): string {
  if (head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a) return 'PE/DOS (MZ)'
  if (head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return 'ELF'
  if (head.length >= 4 && head[0] === 0xfe && head[1] === 0xed && head[2] === 0xfa && (head[3] === 0xce || head[3] === 0xcf))
    return 'Mach-O'
  if (head.length >= 4 && head[0] === 0xcf && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return 'Mach-O'
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) return 'ZIP u otro contenedor PK'
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip'
  return 'desconocido'
}

export const stringsAdapter: ToolAdapter = {
  id: 'strings',
  name: 'Cadenas locales',
  maturity: 'implemented',
  verification: 'Implementación propia en el proceso local. Cubierta por pruebas sobre un archivo de ejemplo.',
  docsUrl: DOC_LINKS.rea,
  installHint: 'Incluida en REA Studio. No usa la red ni ejecuta el archivo.',
  actions: [
    action(
      'extract',
      'Extraer cadenas',
      'Busca cadenas ASCII y UTF-16LE de al menos 4 caracteres. Lee como máximo 64 MB y 8000 cadenas.',
      true,
      'file',
    ),
  ],
  async detect() {
    return baseDetection(this, 'ready', 'Disponible en este equipo. No depende de un programa externo.')
  },
  plan(actionId) {
    if (actionId !== 'extract') throw new Error('Acción de cadenas desconocida.')
    return {
      kind: 'local',
      async run(ctx) {
        if (!ctx.targetPath) throw new Error('Hace falta un archivo.')
        ctx.log('Leyendo cadenas en local.')
        const strings = await extractStrings(ctx.targetPath, ctx.signal)
        const out = path.join(ctx.outputDir, 'strings.txt')
        await writeFile(out, strings.join('\n') + (strings.length ? '\n' : ''), 'utf8')
        return { summary: `${strings.length} cadenas.`, files: [out] }
      },
    }
  },
}

export const metadataAdapter: ToolAdapter = {
  id: 'metadata',
  name: 'Metadatos del archivo',
  maturity: 'implemented',
  verification: 'Hash y magic bytes en el proceso local. Cubierto por pruebas.',
  docsUrl: DOC_LINKS.ghidra,
  installHint: 'Incluida en REA Studio.',
  actions: [
    action('inspect', 'Hash y tipo', 'Tamaño, fecha, SHA-256 y una marca del encabezado. No ejecuta el archivo.', true, 'file'),
  ],
  async detect() {
    return baseDetection(this, 'ready', 'Disponible en este equipo.')
  },
  plan(actionId) {
    if (actionId !== 'inspect') throw new Error('Acción de metadatos desconocida.')
    return {
      kind: 'local',
      async run(ctx) {
        if (!ctx.targetPath) throw new Error('Hace falta un archivo.')
        if (ctx.signal.aborted) throw new Error('Cancelado.')
        const info = await describeFile(ctx.targetPath)
        const out = path.join(ctx.outputDir, 'metadata.json')
        await writeFile(out, `${JSON.stringify(info, null, 2)}\n`, 'utf8')
        ctx.log(`SHA-256 ${String(info.sha256)}`)
        return { summary: `${info.kind}, ${info.bytes} bytes.`, files: [out] }
      },
    }
  },
}

function futureAdapter(spec: (typeof FUTURE)[number]): ToolAdapter {
  return {
    id: spec.id,
    name: spec.name,
    maturity: 'future',
    verification: 'No implementado en v0.1.0.',
    docsUrl: spec.docsUrl,
    installHint: spec.hint,
    actions: [],
    async detect(ctx) {
      const found = findOnPath(spec.binary, ctx.pathEnv, ctx.platform)
      const detail = found
        ? `Hay un ejecutable en ${found}, pero este adaptador no está implementado y no se lanzará.`
        : 'No implementado en v0.1.0.'
      return baseDetection(this, 'unsupported', detail, found ?? undefined)
    },
    plan() {
      throw new Error(`${spec.name} no está implementado en REA Studio 0.1.0.`)
    },
  }
}

function requiredTool(input: PlanInput, key: string, basename: string): string {
  const configured = input.configured[key]?.trim()
  if (configured) return assertAbsoluteUserPath(configured, input.platform)
  const found = findOnPath(basename, input.pathEnv, input.platform)
  if (!found) throw new Error(`No está ${basename}. Indica la ruta en Herramientas.`)
  return found
}

function baseDetection(
  adapter: Pick<ToolAdapter, 'id' | 'name' | 'maturity' | 'verification' | 'docsUrl' | 'installHint' | 'actions'>,
  state: Detection['state'],
  detail: string,
  resolvedPath?: string,
): Detection {
  return {
    id: adapter.id,
    name: adapter.name,
    maturity: adapter.maturity,
    state,
    detail,
    resolvedPath,
    docsUrl: adapter.docsUrl,
    installHint: adapter.installHint,
    verification: adapter.verification,
    actions: adapter.actions,
  }
}

export function createRegistry(): ToolAdapter[] {
  return [
    reaAdapter,
    ghidraAdapter,
    radareAdapter,
    rizinAdapter,
    stringsAdapter,
    metadataAdapter,
    ...FUTURE.map(futureAdapter),
  ]
}

export function adapterById(id: string): ToolAdapter {
  const found = createRegistry().find((item) => item.id === id)
  if (!found) throw new Error('Herramienta desconocida.')
  return found
}

export async function assertTargetExists(target: string, kind: TargetKind): Promise<string> {
  if (kind === 'none') throw new Error('Esta acción no usa un objetivo.')
  const abs = assertAbsoluteUserPath(target)
  const lst = await lstat(abs)
  if (lst.isSymbolicLink()) {
    const real = await realpath(abs)
    return assertTargetExists(real, kind)
  }
  if (kind === 'file' && !lst.isFile()) throw new Error('Hace falta un archivo, no una carpeta.')
  if (kind === 'directory' && !lst.isDirectory()) throw new Error('Hace falta una carpeta.')
  if (kind === 'any' && !lst.isFile() && !lst.isDirectory()) throw new Error('El objetivo no es un archivo ni una carpeta.')
  return abs
}

export async function listOutputFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(current: string) {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push(full)
    }
  }
  await walk(dir)
  return out
}

export async function readTextPreview(file: string, limit = 262144): Promise<{ text: string; bytes: number; truncated: boolean; binary: boolean }> {
  const info = await stat(file)
  const length = Math.min(info.size, limit)
  const handle = await open(file, 'r')
  try {
    const buf = Buffer.alloc(length)
    if (length > 0) await handle.read(buf, 0, length, 0)
    const sample = buf.subarray(0, Math.min(buf.length, 4096))
    let nuls = 0
    for (const byte of sample) if (byte === 0) nuls += 1
    const binary = sample.length > 0 && nuls / sample.length > 0.1
    return {
      text: binary ? '' : buf.toString('utf8'),
      bytes: info.size,
      truncated: info.size > limit,
      binary,
    }
  } finally {
    await handle.close()
  }
}

