import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectFile, TreeEntry } from '../../shared/types.js'
import { assertNoControl, resolveInside } from '../paths.js'

/** Carpetas que el árbol enseña pero no recorre. */
export const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'build', 'bin', 'obj', '__pycache__', '.venv', 'venv', 'dist', 'target', '.rea'])

/** Extensiones de texto que el agente puede escribir. Nada ejecutable directamente (.bat, .cmd, .ps1, .sh, .exe). */
export const WRITABLE_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.md', '.txt',
  '.py', '.toml', '.cfg', '.ini', '.yml', '.yaml',
  '.cs', '.csproj', '.sln', '.props', '.targets', '.resx',
  '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.hh', '.cmake', '.in',
  '.html', '.css', '.xml', '.csv', '.go', '.mod', '.rs',
])
export const WRITABLE_NAMES = new Set(['CMakeLists.txt', '.gitignore', '.editorconfig', 'Makefile', 'README', 'LICENSE'])

export const MAX_WRITE_BYTES = 512 * 1024
export const MAX_READ_BYTES = 256 * 1024
export const MAX_TREE_ENTRIES = 2000

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Valida una ruta relativa al proyecto, sin tocar el disco. Rechaza absolutas,
 * «..», .git, nombres reservados de Windows, flujos alternativos (:) y segmentos
 * que acaban en punto o espacio.
 */
export function assertProjectRelative(relativePath: string): string {
  assertNoControl(relativePath, 'La ruta')
  const unified = relativePath.replace(/\\/g, '/')
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified) || unified.startsWith('//')) {
    throw new Error('Usa una ruta relativa a la carpeta del proyecto.')
  }
  if (unified.includes(':')) throw new Error('La ruta no puede contener «:».')
  const parts = unified.split('/').filter((part) => part !== '' && part !== '.')
  if (parts.length === 0) throw new Error('La ruta está vacía.')
  for (const part of parts) {
    if (part === '..') throw new Error('La ruta sale de la carpeta del proyecto.')
    if (part.toLowerCase() === '.git') throw new Error('La carpeta .git solo la gestiona REA Studio.')
    if (RESERVED.test(part)) throw new Error(`«${part}» es un nombre reservado en Windows.`)
    if (/[. ]$/.test(part)) throw new Error('Un nombre no puede acabar en punto o espacio.')
    if (/[<>"|?*]/.test(part)) throw new Error('La ruta contiene caracteres no válidos.')
  }
  return parts.join('/')
}

export function isOutside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)
}

/** Ruta absoluta confinada al proyecto, siguiendo enlaces de lo que ya existe. */
export async function resolveProjectPath(root: string, relativePath: string, opts: { mustExist?: boolean } = {}): Promise<string> {
  const rel = assertProjectRelative(relativePath)
  const realRoot = await realpath(root)
  const target = resolveInside(realRoot, rel)
  let probe = target
  for (;;) {
    let real: string
    try {
      real = await realpath(probe)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      if (opts.mustExist) throw new Error(`No existe ${rel}.`)
      const parent = path.dirname(probe)
      if (parent === probe) throw new Error('La ruta sale de la carpeta del proyecto.')
      probe = parent
      continue
    }
    if (isOutside(realRoot, real)) throw new Error('La ruta sale de la carpeta del proyecto.')
    return target
  }
}

function isWritableName(rel: string): boolean {
  const base = rel.split('/').pop() ?? ''
  if (WRITABLE_NAMES.has(base)) return true
  const ext = path.extname(base).toLowerCase()
  return ext !== '' && WRITABLE_EXTENSIONS.has(ext)
}

export function assertWritable(relativePath: string): string {
  const rel = assertProjectRelative(relativePath)
  if (!isWritableName(rel)) throw new Error(`No se permite escribir ${rel}: solo archivos de texto de código o configuración.`)
  if (rel.split('/')[0] === '.rea') throw new Error('La carpeta .rea es de REA Studio.')
  if (rel === 'rea-proyecto.json') throw new Error('rea-proyecto.json lo gestiona REA Studio.')
  return rel
}

export async function readProjectFile(root: string, relativePath: string, limit = MAX_READ_BYTES): Promise<ProjectFile> {
  const rel = assertProjectRelative(relativePath)
  const full = await resolveProjectPath(root, rel, { mustExist: true })
  const info = await stat(full)
  if (!info.isFile()) throw new Error(`${rel} no es un archivo.`)
  const buf = await readFile(full)
  const slice = buf.subarray(0, limit)
  const sample = slice.subarray(0, 4096)
  const binary = sample.includes(0)
  return {
    relativePath: rel,
    bytes: info.size,
    truncated: info.size > limit,
    binary,
    text: binary ? '' : slice.toString('utf8'),
  }
}

export async function writeProjectFile(root: string, relativePath: string, content: string): Promise<{ relativePath: string; created: boolean; previous: string | null }> {
  const rel = assertWritable(relativePath)
  if (typeof content !== 'string') throw new Error('El contenido no es texto.')
  if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) throw new Error('El archivo supera el tamaño máximo permitido.')
  if (content.includes('\u0000')) throw new Error('El contenido no puede llevar bytes nulos.')
  const full = await resolveProjectPath(root, rel)
  let previous: string | null = null
  try {
    const info = await lstat(full)
    if (info.isSymbolicLink()) throw new Error('No se escribe a través de enlaces simbólicos.')
    if (!info.isFile()) throw new Error(`${rel} no es un archivo.`)
    previous = await readFile(full, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await mkdir(path.dirname(full), { recursive: true })
  // Tras crear carpetas, vuelve a comprobar el confinamiento.
  await resolveProjectPath(root, rel)
  await writeFile(full, content, 'utf8')
  return { relativePath: rel, created: previous === null, previous }
}

/** Sustituye un fragmento que debe aparecer exactamente una vez. */
export function applyEdit(text: string, search: string, replace: string): string {
  if (!search) throw new Error('El texto a buscar está vacío.')
  const first = text.indexOf(search)
  if (first === -1) throw new Error('No se encontró el texto a buscar.')
  if (text.indexOf(search, first + search.length) !== -1) throw new Error('El texto a buscar aparece más de una vez. Da más contexto.')
  return text.slice(0, first) + replace + text.slice(first + search.length)
}

export async function listProjectTree(root: string, opts: { maxEntries?: number; maxDepth?: number; status?: Map<string, string> } = {}): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
  const maxEntries = opts.maxEntries ?? MAX_TREE_ENTRIES
  const maxDepth = opts.maxDepth ?? 10
  const realRoot = await realpath(root)
  const entries: TreeEntry[] = []
  let truncated = false
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    const items: Array<{ name: string; isDir: boolean; isLink: boolean; size: number }> = []
    for (const name of names) {
      try {
        const info = await lstat(path.join(dir, name))
        items.push({ name, isDir: info.isDirectory(), isLink: info.isSymbolicLink(), size: info.size })
      } catch {
        /* desapareció */
      }
    }
    items.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1))
    for (const item of items) {
      if (entries.length >= maxEntries) {
        truncated = true
        return
      }
      const childRel = rel ? `${rel}/${item.name}` : item.name
      if (item.isLink) {
        entries.push({ path: childRel, kind: 'link', depth })
        continue
      }
      if (item.isDir) {
        const skipped = SKIPPED_DIRS.has(item.name)
        entries.push({ path: childRel, kind: 'dir', depth, skipped })
        if (!skipped && depth < maxDepth) await walk(path.join(dir, item.name), childRel, depth + 1)
        continue
      }
      entries.push({ path: childRel, kind: 'file', depth, bytes: item.size, status: opts.status?.get(childRel) })
    }
  }
  await walk(realRoot, '', 0)
  return { entries, truncated }
}

/** Resumen corto del árbol para el modelo. */
export function treeSummary(entries: TreeEntry[], max = 120): string {
  const lines = entries.slice(0, max).map((entry) => `${'  '.repeat(entry.depth)}${entry.path.split('/').pop()}${entry.kind === 'dir' ? '/' : ''}${entry.skipped ? ' (omitida)' : ''}`)
  if (entries.length > max) lines.push(`… y ${entries.length - max} entradas más`)
  return lines.join('\n')
}
