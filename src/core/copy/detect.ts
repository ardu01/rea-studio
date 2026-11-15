import { lstat, open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ProgramDetection, ProgramKind } from '../../shared/types.js'
import { assertAbsoluteUserPath } from '../paths.js'
import { KIND_LABEL, defaultProjectsDir, projectNameFrom, templateLabel } from './names.js'

export { KIND_LABEL, defaultProjectsDir, projectNameFrom, templateLabel } from './names.js'

const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', 'bin', 'obj', '.idea', '.vs'])
const MAX_ENTRIES = 250
const MAX_DEPTH = 3

/** Módulos del sistema que no se analizan (DLL o .so que no son del programa). */
const SYSTEM_MODULE = /^(kernel32|user32|gdi32|ntdll|advapi32|shell32|ole32|oleaut32|comctl32|comdlg32|ws2_32|wsock32|msvcrt|ucrtbase|vcruntime\d*|msvcp\d*|concrt\d*|secur32|crypt32|winhttp|wininet|shlwapi|rpcrt4|imm32|uxtheme|dwmapi|setupapi|version|winmm|avrt|bcrypt|ncrypt|iphlpapi|dnsapi|psapi|dbghelp|imagehlp|hid|xinput\d*|d3d\d+|d3dcompiler\d*|dxgi|opengl32|glu32|gdiplus|wow64.*|kernelbase|sechost|cfgmgr32|nsi|mswsock|normaliz|powrprof|profapi|wtsapi32|userenv|netapi32|wintrust|msimg32|cabinet|mpr|winspool|ntdll|libc|libm|libdl|libpthread|libgcc|libstdc\+\+|ld-linux|libsystem|libobjc|libdispatch)$/i

export const MAX_LISTED_MODULES = 20

export function isSystemModule(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (lower.startsWith('api-ms-') || lower.startsWith('ext-ms-')) return true
  const stem = lower.replace(/\.(dll|dylib)$/i, '').replace(/\.so(?:\.\d+)*$/i, '')
  return SYSTEM_MODULE.test(stem)
}

export interface PeInspection {
  kind: 'pe'
  managed: boolean
  pyinstaller: boolean
}

export function inspectPeBuffer(buf: Buffer): PeInspection | null {
  if (buf.length < 64 || buf[0] !== 0x4d || buf[1] !== 0x5a) return null
  const e_lfanew = buf.readUInt32LE(0x3c)
  if (e_lfanew < 0 || e_lfanew + 24 + 112 + 16 * 8 > buf.length) {
    return { kind: 'pe', managed: false, pyinstaller: hasPyInstaller(buf) }
  }
  if (buf.toString('ascii', e_lfanew, e_lfanew + 4) !== 'PE\0\0') {
    return { kind: 'pe', managed: false, pyinstaller: hasPyInstaller(buf) }
  }
  const optionalOff = e_lfanew + 24
  const magic = buf.readUInt16LE(optionalOff)
  const dirsOff = magic === 0x20b ? optionalOff + 112 : magic === 0x10b ? optionalOff + 96 : -1
  const numRvaOff = magic === 0x20b ? optionalOff + 108 : magic === 0x10b ? optionalOff + 92 : -1
  let managed = false
  if (dirsOff > 0 && numRvaOff > 0 && numRvaOff + 4 <= buf.length) {
    const count = buf.readUInt32LE(numRvaOff)
    const comIndex = 14
    const entry = dirsOff + comIndex * 8
    if (count > comIndex && entry + 8 <= buf.length) {
      const rva = buf.readUInt32LE(entry)
      const size = buf.readUInt32LE(entry + 4)
      managed = rva !== 0 && size !== 0
    }
  }
  return { kind: 'pe', managed, pyinstaller: hasPyInstaller(buf) }
}

export function hasPyInstaller(buf: Buffer): boolean {
  if (buf.includes(Buffer.from('PyInstaller'))) return true
  if (buf.includes(Buffer.from('MEIPASS'))) return true
  // cookie al final de muchos onefile
  if (buf.length >= 24 && buf.subarray(buf.length - 24, buf.length).includes(Buffer.from('MEI'))) return true
  return false
}

export async function inspectPeFile(file: string): Promise<PeInspection | null> {
  const st = await stat(file)
  const handle = await open(file, 'r')
  try {
    const headLen = Math.min(st.size, 4096)
    const head = Buffer.alloc(headLen)
    await handle.read(head, 0, head.length, 0)
    const parsed = inspectPeBuffer(head)
    if (!parsed) return null
    if (parsed.pyinstaller || parsed.managed) return parsed
    // PyInstaller a menudo deja la marca al final
    if (st.size > 4096) {
      const tailLen = Math.min(st.size, 1024 * 1024)
      const tail = Buffer.alloc(tailLen)
      await handle.read(tail, 0, tail.length, Math.max(0, st.size - tailLen))
      if (hasPyInstaller(tail)) return { ...parsed, pyinstaller: true }
    }
    return parsed
  } finally {
    await handle.close()
  }
}

function magicOf(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'pe'
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'elf'
  if (buf.length >= 4 && buf[0] === 0xfe && buf[1] === 0xed && buf[2] === 0xfa) return 'macho'
  if (buf.length >= 4 && buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe) return 'macho'
  if (buf.length >= 4 && buf[0] === 0xca && buf[1] === 0xfe && buf[2] === 0xba && buf[3] === 0xbe) return 'macho'
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'
  return 'other'
}

async function readHead(file: string, size = 16): Promise<Buffer> {
  const st = await stat(file)
  const n = Math.min(size, st.size)
  const buf = Buffer.alloc(n)
  if (n === 0) return buf
  const handle = await open(file, 'r')
  try {
    await handle.read(buf, 0, n, 0)
    return buf
  } finally {
    await handle.close()
  }
}

interface Scan {
  files: string[]
  dirs: string[]
  names: Set<string>
}

async function scanTree(root: string): Promise<Scan> {
  const files: string[] = []
  const dirs: string[] = []
  const names = new Set<string>()
  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length + dirs.length >= MAX_ENTRIES) return
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      return
    }
    for (const name of entries) {
      if (files.length + dirs.length >= MAX_ENTRIES) return
      names.add(name.toLowerCase())
      const full = path.join(dir, name)
      let st
      try {
        st = await lstat(full)
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        dirs.push(full)
        if (depth < MAX_DEPTH && !SKIP.has(name)) await walk(full, depth + 1)
      } else if (st.isFile()) {
        files.push(full)
      }
    }
  }
  await walk(root, 0)
  return { files, dirs, names }
}

function looksElectron(names: Set<string>, packageJson?: unknown): { electron: boolean; javascript: boolean } {
  const hasAsar = [...names].some((n) => n.endsWith('.asar'))
  const pkg = packageJson && typeof packageJson === 'object' ? (packageJson as Record<string, unknown>) : null
  const deps = {
    ...(typeof pkg?.dependencies === 'object' && pkg.dependencies ? pkg.dependencies : {}),
    ...(typeof pkg?.devDependencies === 'object' && pkg.devDependencies ? pkg.devDependencies : {}),
  } as Record<string, unknown>
  const electronDep = 'electron' in deps || 'electron-builder' in deps
  const main = typeof pkg?.main === 'string'
  return {
    electron: hasAsar || electronDep || names.has('electron.exe') || names.has('electron'),
    javascript: Boolean(pkg) || hasAsar || names.has('package.json') || main,
  }
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as unknown
  } catch {
    return undefined
  }
}

function pickExe(files: string[]): string | undefined {
  const ranked = files.filter((f) => /\.(exe|dll|so|dylib|bin)$/i.test(f) || !path.extname(f))
  const exe = ranked.find((f) => f.toLowerCase().endsWith('.exe'))
  return exe ?? ranked[0]
}


export async function detectProgram(
  sourcePath: string,
  opts?: { destParent?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv },
): Promise<ProgramDetection> {
  const abs = assertAbsoluteUserPath(sourcePath)
  const st = await lstat(abs)
  if (st.isSymbolicLink()) return detectProgram(await realpath(abs), opts)
  const sourceKind: 'file' | 'folder' = st.isDirectory() ? 'folder' : 'file'
  if (!st.isDirectory() && !st.isFile()) {
    return unknown(abs, sourceKind, 'No he reconocido este archivo como una aplicación.', opts)
  }
  const name = projectNameFrom(abs)
  const destParent = opts?.destParent ?? defaultProjectsDir({ platform: opts?.platform, env: opts?.env })
  const suggestedDest = (opts?.platform === 'win32' ? path.win32 : opts?.platform ? path.posix : path).join(destParent, name)
  const joinDest = (kind: ProgramKind | 'unknown', label: string, template: ProgramDetection['template'], extras: Partial<ProgramDetection> = {}): ProgramDetection => ({
    sourcePath: abs,
    sourceKind,
    name,
    kind,
    kindLabel: label,
    template,
    templateLabel: templateLabel(template),
    suggestedDest,
    ...extras,
  })

  if (st.isDirectory()) {
    const scan = await scanTree(abs)
    const pkgPath = scan.files.find((f) => path.basename(f).toLowerCase() === 'package.json')
    const pkg = pkgPath ? await readJson(pkgPath) : undefined
    const js = looksElectron(scan.names, pkg)
    const hasCsproj = [...scan.names].some((n) => n.endsWith('.csproj') || n.endsWith('.sln') || n.endsWith('.vbproj'))
    const hasPython =
      scan.names.has('pyproject.toml') ||
      scan.names.has('setup.py') ||
      scan.names.has('requirements.txt') ||
      [...scan.names].some((n) => n.endsWith('.py') || n.endsWith('.pyc') || n === '__pycache__')
    const asar = scan.files.find((f) => f.toLowerCase().endsWith('.asar'))
    if (js.electron || js.javascript) {
      const kind: ProgramKind = js.electron ? 'electron' : 'javascript'
      return joinDest(kind, KIND_LABEL[kind], 'node', {
        folderTarget: abs,
        fileTarget: asar ?? pickExe(scan.files),
      })
    }
    if (looksJavaProject(scan.names, scan.files)) {
      const apk = scan.files.find((f) => /\.(apk|jar|dex|aar)$/i.test(f))
      return joinDest('java', KIND_LABEL.java, 'java', {
        folderTarget: abs,
        fileTarget: apk,
      })
    }
    if (hasCsproj) {
      return joinDest('dotnet', KIND_LABEL.dotnet, 'dotnet', {
        folderTarget: abs,
        fileTarget: pickExe(scan.files) ?? scan.files.find((f) => f.toLowerCase().endsWith('.dll')),
      })
    }
    if (hasPython) {
      return joinDest('python', KIND_LABEL.python, 'python', {
        folderTarget: abs,
        fileTarget: scan.files.find((f) => f.toLowerCase().endsWith('.pyc')) ?? pickExe(scan.files),
      })
    }
    const exe = pickExe(scan.files)
    if (exe) {
      const inner = await detectFile(exe, destParent, name, suggestedDest)
      if (inner.kind !== 'unknown') {
        const modules = inner.kind === 'native' || inner.kind === 'dotnet' ? await listCompanionModules(abs, exe) : inner.modules
        return { ...inner, sourcePath: abs, sourceKind: 'folder', folderTarget: abs, fileTarget: exe, name, suggestedDest, modules }
      }
    }
    if (looksNativeSources(scan.names)) {
      return joinDest('native', KIND_LABEL.native, 'cmake', { folderTarget: abs, fileTarget: exe })
    }
    return unknown(
      abs,
      'folder',
      'No parece una aplicación (ejecutable, Electron, .NET, Java/APK, Python o nativo). Si lo es, elige el ejecutable o la carpeta del programa.',
      opts,
      name,
      suggestedDest,
    )
  }

  return detectFile(abs, destParent, name, suggestedDest)
}

async function detectFile(abs: string, destParent: string, name: string, suggestedDest: string): Promise<ProgramDetection> {
  const ext = path.extname(abs).toLowerCase()
  const base = { sourcePath: abs, sourceKind: 'file' as const, name, suggestedDest, fileTarget: abs }
  if (ext === '.asar' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    const beside = ext === '.asar' ? null : await electronBeside(abs)
    if (beside) {
      return { ...base, kind: 'electron', kindLabel: KIND_LABEL.electron, template: 'node', templateLabel: templateLabel('node'), folderTarget: beside.folder, fileTarget: beside.asar ?? abs }
    }
    return { ...base, kind: 'javascript', kindLabel: KIND_LABEL.javascript, template: 'node', templateLabel: templateLabel('node') }
  }
  if (ext === '.csproj' || ext === '.sln' || ext === '.vbproj') {
    return { ...base, kind: 'dotnet', kindLabel: KIND_LABEL.dotnet, template: 'dotnet', templateLabel: templateLabel('dotnet') }
  }
  if (ext === '.py' || ext === '.pyc' || ext === '.pyz') {
    return { ...base, kind: 'python', kindLabel: KIND_LABEL.python, template: 'python', templateLabel: templateLabel('python') }
  }
  if (ext === '.java' || ext === '.kt' || ext === '.apk' || ext === '.jar' || ext === '.dex' || ext === '.aar' || ext === '.class') {
    return { ...base, kind: 'java', kindLabel: KIND_LABEL.java, template: 'java', templateLabel: templateLabel('java') }
  }
  const head = await readHead(abs, 16)
  const magic = magicOf(head)
  if (magic === 'zip' || ext === '.zip') {
    if (await looksJavaZip(abs)) {
      return { ...base, kind: 'java', kindLabel: KIND_LABEL.java, template: 'java', templateLabel: templateLabel('java') }
    }
  }
  if (magic === 'pe') {
    const pe = (await inspectPeFile(abs)) ?? { kind: 'pe' as const, managed: false, pyinstaller: false }
    if (pe.managed) {
      const modules = await listCompanionModules(path.dirname(abs), abs)
      return { ...base, kind: 'dotnet', kindLabel: KIND_LABEL.dotnet, template: 'dotnet', templateLabel: templateLabel('dotnet'), modules }
    }
    if (pe.pyinstaller) return { ...base, kind: 'python', kindLabel: KIND_LABEL.python, template: 'python', templateLabel: templateLabel('python') }
    const electron = await electronBeside(abs)
    if (electron) {
      return {
        ...base,
        kind: 'electron',
        kindLabel: KIND_LABEL.electron,
        template: 'node',
        templateLabel: templateLabel('node'),
        folderTarget: electron.folder,
        fileTarget: electron.asar ?? abs,
        note: 'He encontrado un paquete Electron (app.asar) junto al ejecutable.',
      }
    }
    const modules = await listCompanionModules(path.dirname(abs), abs)
    return { ...base, kind: 'native', kindLabel: KIND_LABEL.native, template: 'cmake', templateLabel: templateLabel('cmake'), modules }
  }
  if (magic === 'elf' || magic === 'macho') {
    const bufTail = await readTail(abs, 256 * 1024)
    if (hasPyInstaller(Buffer.concat([head, bufTail]))) {
      return { ...base, kind: 'python', kindLabel: KIND_LABEL.python, template: 'python', templateLabel: templateLabel('python') }
    }
    const modules = await listCompanionModules(path.dirname(abs), abs)
    return { ...base, kind: 'native', kindLabel: KIND_LABEL.native, template: 'cmake', templateLabel: templateLabel('cmake'), modules }
  }
  if (ext === '.exe' || ext === '.dll' || ext === '.so' || ext === '.dylib') {
    const electron = await electronBeside(abs)
    if (electron) {
      return {
        ...base,
        kind: 'electron',
        kindLabel: KIND_LABEL.electron,
        template: 'node',
        templateLabel: templateLabel('node'),
        folderTarget: electron.folder,
        fileTarget: electron.asar ?? abs,
      }
    }
    const modules = await listCompanionModules(path.dirname(abs), abs)
    return { ...base, kind: 'native', kindLabel: KIND_LABEL.native, template: 'cmake', templateLabel: templateLabel('cmake'), modules }
  }
  return unknown(
    abs,
    'file',
    'No parece una aplicación (ejecutable, Electron, .NET, Java/APK, Python o nativo). Si lo es, elige el ejecutable o la carpeta del programa.',
    undefined,
    name,
    suggestedDest,
  )
}

/** Si se elige solo el .exe de una app Electron (p. ej. Jerry.exe), busca resources/app.asar al lado. */
export async function electronBeside(exePath: string): Promise<{ folder: string; asar?: string } | null> {
  const dir = path.dirname(exePath)
  const asarCandidates = [path.join(dir, 'resources', 'app.asar'), path.join(dir, 'app.asar')]
  for (const candidate of asarCandidates) {
    try {
      const st = await stat(candidate)
      if (st.isFile() && st.size > 0) return { folder: dir, asar: candidate }
    } catch {
      /* sigue */
    }
  }
  const unpacked = path.join(dir, 'resources', 'app')
  try {
    const st = await stat(unpacked)
    if (st.isDirectory()) return { folder: unpacked }
  } catch {
    /* no hay app descomprimida */
  }
  return null
}

export async function listCompanionModules(root: string, mainFile?: string): Promise<Array<{ path: string; name: string; bytes: number }>> {
  let scan: Scan
  try {
    const st = await stat(root)
    scan = st.isDirectory() ? await scanTree(root) : await scanTree(path.dirname(root))
  } catch {
    return []
  }
  const mainReal = mainFile ? path.resolve(mainFile) : ''
  const found: Array<{ path: string; name: string; bytes: number }> = []
  for (const file of scan.files) {
    if (!/\.(dll|so|dylib)$/i.test(file) && !/\.so\.\d/i.test(file)) continue
    if (mainReal && path.resolve(file) === mainReal) continue
    const name = path.basename(file)
    if (isSystemModule(name)) continue
    try {
      const st = await stat(file)
      if (!st.isFile() || st.size <= 0) continue
      found.push({ path: file, name, bytes: st.size })
    } catch {
      continue
    }
  }
  found.sort((a, b) => b.bytes - a.bytes)
  return found.slice(0, MAX_LISTED_MODULES)
}

function looksJavaProject(names: Set<string>, files: string[]): boolean {
  if ([...names].some((n) => n === 'androidmanifest.xml' || n === 'pom.xml' || n === 'build.gradle' || n === 'build.gradle.kts' || n === 'settings.gradle' || n === 'settings.gradle.kts')) {
    return true
  }
  return files.some((f) => /\.(java|kt|apk|jar|dex|aar|class)$/i.test(f))
}

function looksNativeSources(names: Set<string>): boolean {
  if ([...names].some((n) => n === 'cmakelists.txt' || n === 'meson.build')) return true
  return [...names].some((n) => /\.(c|cc|cpp|cxx|h|hpp|hh)$/i.test(n))
}

async function looksJavaZip(file: string): Promise<boolean> {
  try {
    const buf = await readHead(file, 256 * 1024)
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return false
    const text = buf.toString('binary')
    return /AndroidManifest\.xml|classes\.dex|\.class\b|META-INF\/MANIFEST\.MF/i.test(text)
  } catch {
    return false
  }
}

async function readTail(file: string, size: number): Promise<Buffer> {
  const st = await stat(file)
  const n = Math.min(size, st.size)
  const buf = Buffer.alloc(n)
  if (n === 0) return buf
  const handle = await open(file, 'r')
  try {
    await handle.read(buf, 0, n, Math.max(0, st.size - n))
    return buf
  } finally {
    await handle.close()
  }
}

function unknown(
  sourcePath: string,
  sourceKind: 'file' | 'folder',
  reason: string,
  opts?: { destParent?: string; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv },
  name?: string,
  suggestedDest?: string,
): ProgramDetection {
  const resolvedName = name ?? projectNameFrom(sourcePath)
  const destParent = opts?.destParent ?? defaultProjectsDir({ platform: opts?.platform, env: opts?.env })
  return {
    sourcePath,
    sourceKind,
    name: resolvedName,
    kind: 'unknown',
    kindLabel: 'No reconocido',
    template: null,
    templateLabel: null,
    suggestedDest: suggestedDest ?? path.join(destParent, resolvedName),
    reason,
  }
}
