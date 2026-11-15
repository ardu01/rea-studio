import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { assertInside } from '../paths.js'

/**
 * Ficha del análisis: lo que REA Studio sabe del programa de referencia,
 * resumido para que el agente lo consulte con la herramienta «referencia».
 * Se construye solo a partir de artefactos del espacio de trabajo.
 */

const MAX_JSON_BYTES = 16 * 1024 * 1024
const MAX_STRINGS_BYTES = 4 * 1024 * 1024
const MAX_FUNCTIONS = 2000
const MAX_IMPORTS = 3000
const MAX_TYPES = 400
const MAX_STRINGS = 1500

const typeSchema = z.object({
  name: z.string().max(300),
  kind: z.enum(['struct', 'union', 'enum']),
  size: z.number().int(),
  fields: z.array(z.object({ name: z.string().max(300), type: z.string().max(300), offset: z.number().int(), size: z.number().int() })).max(64).optional(),
  values: z.array(z.object({ name: z.string().max(300), value: z.number() })).max(64).optional(),
})

export const fichaSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  sources: z.array(z.object({ path: z.string(), kind: z.string(), note: z.string().optional() })).max(100),
  program: z
    .object({
      name: z.string().optional(),
      format: z.string().optional(),
      language: z.string().optional(),
      compiler: z.string().optional(),
      imageBase: z.string().optional(),
      functionCount: z.number().int().optional(),
    })
    .optional(),
  file: z.object({ name: z.string().optional(), kind: z.string().optional(), bytes: z.number().optional(), sha256: z.string().optional() }).optional(),
  functions: z.array(z.object({ name: z.string().max(300), entry: z.string().max(40).optional() })).max(MAX_FUNCTIONS),
  imports: z.array(z.object({ library: z.string().max(300).optional(), name: z.string().max(300) })).max(MAX_IMPORTS),
  exports: z.array(z.string().max(300)).max(MAX_FUNCTIONS),
  types: z.array(typeSchema).max(MAX_TYPES),
  strings: z.array(z.string().max(300)).max(MAX_STRINGS),
})

export type Ficha = z.infer<typeof fichaSchema>
export type FichaType = z.infer<typeof typeSchema>

export const FICHA_DIR = 'referencia'
export const FICHA_JSON = 'referencia/ficha.json'
export const FICHA_MD = 'referencia/ficha.md'

/** Quita rutas de usuario (C:\Users\nombre, /home/nombre, /Users/nombre) de un texto. */
export function redactUserPaths(text: string): string {
  return text
    .replace(/([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"']+/gi, '$1<usuario>')
    .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<usuario>')
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? redactUserPaths(value.trim()).slice(0, 300) : undefined
}

function emptyFicha(): Ficha {
  return { version: 1, generatedAt: new Date().toISOString(), sources: [], functions: [], imports: [], exports: [], types: [], strings: [] }
}

/** Cadenas útiles: legibles, de 5 a 200 caracteres, sin duplicados y sin rutas de usuario. */
export function filterStrings(lines: string[], max = MAX_STRINGS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length < 5 || line.length > 200) continue
    const letters = line.match(/[\p{L}]/gu)?.length ?? 0
    if (letters / line.length < 0.5) continue
    if (/^[A-Za-z]{5,}$/.test(line) && !/[aeiou]/i.test(line)) continue
    if (/(.)\1{4,}/.test(line)) continue
    const clean = redactUserPaths(line)
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
    if (out.length >= max) break
  }
  return out
}

function parseJsonLoose(text: string): unknown[] {
  const trimmed = text.trim()
  if (!trimmed || !/^[[{]/.test(trimmed)) return []
  try {
    return [JSON.parse(trimmed)]
  } catch {
    const out: unknown[] = []
    for (const line of trimmed.split(/\r?\n/)) {
      const piece = line.trim()
      if (!/^[[{]/.test(piece)) continue
      try {
        out.push(JSON.parse(piece))
      } catch {
        /* línea que no es JSON */
      }
    }
    return out
  }
}

const LIB_KEYS = ['library', 'libname', 'lib', 'dll', 'module', 'dllName']
const NAME_KEYS = ['name', 'function', 'symbol', 'func', 'importName']

/**
 * Recorre JSON genérico (rabin2 -j, rea inspect-pe-imports --json…) y recoge
 * importaciones y exportaciones sin depender de un formato exacto.
 */
export function collectSymbols(value: unknown, ficha: Ficha, context: 'imports' | 'exports' | null = null, depth = 0): void {
  if (depth > 12 || value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20_000)) {
      if (typeof item === 'string' && context) addSymbol(ficha, context, { name: item })
      else collectSymbols(item, ficha, context, depth + 1)
    }
    return
  }
  const record = value as Record<string, unknown>
  if (context) {
    const name = NAME_KEYS.map((key) => str(record[key])).find(Boolean)
    const library = LIB_KEYS.map((key) => str(record[key])).find(Boolean)
    if (name) addSymbol(ficha, context, { name, library })
  }
  for (const [key, child] of Object.entries(record)) {
    const lower = key.toLowerCase()
    const next = lower.includes('import') ? 'imports' : lower.includes('export') ? 'exports' : context
    if (next === 'imports' && child && typeof child === 'object' && !Array.isArray(child) && context !== 'imports') {
      // { "KERNEL32.dll": ["CreateFileW", ...] }
      for (const [library, list] of Object.entries(child as Record<string, unknown>)) {
        if (Array.isArray(list)) {
          for (const item of list.slice(0, 5000)) {
            if (typeof item === 'string') addSymbol(ficha, 'imports', { name: item, library })
            else if (item && typeof item === 'object') {
              const entry = item as Record<string, unknown>
              const name = NAME_KEYS.map((k) => str(entry[k])).find(Boolean)
              if (name) addSymbol(ficha, 'imports', { name, library: LIB_KEYS.map((k) => str(entry[k])).find(Boolean) ?? library })
            }
          }
        } else collectSymbols(list, ficha, 'imports', depth + 2)
      }
      continue
    }
    collectSymbols(child, ficha, next, depth + 1)
  }
}

function addSymbol(ficha: Ficha, kind: 'imports' | 'exports', symbol: { name: string; library?: string }): void {
  const name = str(symbol.name)
  if (!name) return
  if (kind === 'exports') {
    if (ficha.exports.length < MAX_FUNCTIONS && !ficha.exports.includes(name)) ficha.exports.push(name)
    return
  }
  const library = str(symbol.library)
  if (ficha.imports.length >= MAX_IMPORTS) return
  if (ficha.imports.some((item) => item.name === name && item.library === library)) return
  ficha.imports.push(library ? { library, name } : { name })
}

function addGhidraSummary(json: Record<string, unknown>, ficha: Ficha): void {
  ficha.program = {
    name: str(json.name),
    format: str(json.format),
    language: str(json.language),
    compiler: str(json.compiler),
    imageBase: str(json.imageBase),
    functionCount: typeof json.functionCount === 'number' ? json.functionCount : undefined,
  }
  if (Array.isArray(json.functions)) {
    for (const item of json.functions) {
      if (ficha.functions.length >= MAX_FUNCTIONS) break
      const record = (item ?? {}) as Record<string, unknown>
      const name = str(record.name)
      if (name) ficha.functions.push({ name, entry: str(record.entry)?.slice(0, 40) })
    }
  }
}

function addGhidraTypes(json: Record<string, unknown>, ficha: Ficha): void {
  if (!Array.isArray(json.types)) return
  for (const item of json.types) {
    if (ficha.types.length >= MAX_TYPES) break
    const parsed = typeSchema.safeParse(item && typeof item === 'object' ? { ...(item as object), fields: (item as { fields?: unknown[] }).fields?.slice(0, 64), values: (item as { values?: unknown[] }).values?.slice(0, 64) } : item)
    if (parsed.success) ficha.types.push(parsed.data)
  }
}

/** Construye la ficha a partir de artefactos (rutas relativas al espacio de trabajo). */
export async function buildFicha(workspace: string, references: string[]): Promise<Ficha> {
  const ficha = emptyFicha()
  for (const relative of references.slice(0, 50)) {
    const display = redactUserPaths(relative.replace(/\\/g, '/'))
    let full: string
    try {
      full = assertInside(workspace, relative)
    } catch {
      ficha.sources.push({ path: display, kind: 'omitido', note: 'Fuera del espacio de trabajo.' })
      continue
    }
    const base = path.basename(full).toLowerCase()
    try {
      const info = await stat(full)
      if (!info.isFile()) throw new Error('No es un archivo.')
      if (base === 'strings.txt') {
        const text = (await readHead(full, MAX_STRINGS_BYTES)).toString('utf8')
        const before = ficha.strings.length
        for (const item of filterStrings(text.split(/\r?\n/), MAX_STRINGS - ficha.strings.length)) {
          if (!ficha.strings.includes(item)) ficha.strings.push(item)
        }
        ficha.sources.push({ path: display, kind: 'cadenas', note: `${ficha.strings.length - before} cadenas útiles.` })
        continue
      }
      if (info.size > MAX_JSON_BYTES) {
        ficha.sources.push({ path: display, kind: 'omitido', note: 'Demasiado grande.' })
        continue
      }
      const docs = parseJsonLoose(await readFile(full, 'utf8'))
      if (docs.length === 0) {
        ficha.sources.push({ path: display, kind: 'omitido', note: 'No es JSON ni una lista de cadenas.' })
        continue
      }
      const first = docs[0] as Record<string, unknown>
      if (base === 'ghidra-summary.json') {
        addGhidraSummary(first, ficha)
        ficha.sources.push({ path: display, kind: 'ghidra', note: `${ficha.functions.length} funciones.` })
      } else if (base === 'ghidra-types.json') {
        addGhidraTypes(first, ficha)
        ficha.sources.push({ path: display, kind: 'tipos', note: `${ficha.types.length} tipos.` })
      } else if (base === 'metadata.json') {
        ficha.file = {
          name: typeof first.path === 'string' ? path.basename(first.path.replace(/\\/g, '/')) : undefined,
          kind: str(first.kind),
          bytes: typeof first.bytes === 'number' ? first.bytes : undefined,
          sha256: typeof first.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(first.sha256) ? first.sha256 : undefined,
        }
        ficha.sources.push({ path: display, kind: 'metadatos' })
      } else {
        const beforeImports = ficha.imports.length
        const beforeExports = ficha.exports.length
        for (const doc of docs) collectSymbols(doc, ficha)
        ficha.sources.push({
          path: display,
          kind: 'json',
          note: `${ficha.imports.length - beforeImports} importaciones, ${ficha.exports.length - beforeExports} exportaciones.`,
        })
      }
    } catch (error) {
      ficha.sources.push({ path: display, kind: 'error', note: error instanceof Error ? redactUserPaths(error.message).slice(0, 200) : 'No se pudo leer.' })
    }
  }
  return fichaSchema.parse(ficha)
}

async function readHead(file: string, max: number): Promise<Buffer> {
  const { open } = await import('node:fs/promises')
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(max)
    const { bytesRead } = await handle.read(buffer, 0, max, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function typeLine(type: FichaType): string {
  if (type.kind === 'enum') return `enum ${type.name} { ${(type.values ?? []).map((v) => `${v.name} = ${v.value}`).join(', ')} }`
  return `${type.kind} ${type.name} (${type.size} bytes) { ${(type.fields ?? []).map((f) => `+${f.offset} ${f.type} ${f.name}`).join('; ')} }`
}

function importsByLibrary(ficha: Ficha): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const item of ficha.imports) {
    const key = item.library ?? '(sin biblioteca)'
    map.set(key, [...(map.get(key) ?? []), item.name])
  }
  return map
}

const GENERIC_FN = /^(FUN|thunk_FUN|LAB|SUB|sub|fcn)[_.][0-9a-f]+$/i

/** Resumen corto para el primer mensaje del agente. */
export function fichaSummary(ficha: Ficha, maxChars = 2500): string {
  const lines: string[] = []
  const p = ficha.program
  if (p) lines.push(`Programa: ${[p.name, p.format, p.language, p.compiler].filter(Boolean).join(' · ')}${p.functionCount !== undefined ? ` · ${p.functionCount} funciones` : ''}`)
  if (ficha.file) lines.push(`Archivo: ${[ficha.file.kind, ficha.file.bytes !== undefined ? `${ficha.file.bytes} bytes` : ''].filter(Boolean).join(', ')}`)
  const named = ficha.functions.filter((fn) => !GENERIC_FN.test(fn.name))
  if (named.length) lines.push(`Funciones con nombre (${named.length}): ${named.slice(0, 40).map((fn) => fn.name).join(', ')}`)
  const libs = importsByLibrary(ficha)
  if (libs.size) lines.push(`Importaciones: ${[...libs].slice(0, 12).map(([lib, names]) => `${lib} (${names.slice(0, 8).join(', ')}${names.length > 8 ? '…' : ''})`).join('; ')}`)
  if (ficha.exports.length) lines.push(`Exportaciones: ${ficha.exports.slice(0, 30).join(', ')}`)
  if (ficha.types.length) lines.push(`Tipos: ${ficha.types.slice(0, 30).map((t) => t.name).join(', ')}`)
  if (ficha.strings.length) lines.push(`Cadenas (${ficha.strings.length}), p. ej.: ${ficha.strings.slice(0, 12).map((s) => JSON.stringify(s)).join(', ')}`)
  const text = lines.join('\n')
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text
}

/** Búsqueda simple sin distinguir mayúsculas en todas las secciones de la ficha. */
export function searchFicha(ficha: Ficha, query: string, max = 60): string {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .slice(0, 8)
  if (!terms.length) return fichaSummary(ficha)
  const match = (text: string) => {
    const lower = text.toLowerCase()
    return terms.every((term) => lower.includes(term))
  }
  const sections: Array<[string, string[]]> = [
    ['Funciones', ficha.functions.filter((fn) => match(fn.name)).map((fn) => `${fn.name}${fn.entry ? ` @ ${fn.entry}` : ''}`)],
    ['Importaciones', ficha.imports.filter((item) => match(`${item.library ?? ''} ${item.name}`)).map((item) => (item.library ? `${item.library}!${item.name}` : item.name))],
    ['Exportaciones', ficha.exports.filter(match)],
    ['Tipos', ficha.types.filter((type) => match(typeLine(type))).map(typeLine)],
    ['Cadenas', ficha.strings.filter(match).map((s) => JSON.stringify(s))],
  ]
  const out: string[] = []
  let left = max
  for (const [title, items] of sections) {
    if (!items.length || left <= 0) continue
    const shown = items.slice(0, left)
    left -= shown.length
    out.push(`${title} (${items.length}):\n${shown.map((item) => `  ${item}`).join('\n')}${items.length > shown.length ? '\n  …' : ''}`)
  }
  return out.length ? out.join('\n\n') : `Nada en la ficha coincide con «${query}».`
}

/** Versión legible de la ficha (referencia/ficha.md). */
export function fichaMarkdown(ficha: Ficha): string {
  const lines: string[] = ['# Ficha del análisis', '', 'Generada por REA Studio a partir de los artefactos del análisis. Solo lectura para el agente: es una guía, no código para copiar.', '']
  const p = ficha.program
  if (p || ficha.file) {
    lines.push('## Programa', '')
    if (p?.name) lines.push(`- Nombre: ${p.name}`)
    if (p?.format) lines.push(`- Formato: ${p.format}`)
    if (p?.language) lines.push(`- Arquitectura: ${p.language}`)
    if (p?.compiler) lines.push(`- Compilador: ${p.compiler}`)
    if (p?.imageBase) lines.push(`- Base: ${p.imageBase}`)
    if (p?.functionCount !== undefined) lines.push(`- Funciones: ${p.functionCount}`)
    if (ficha.file?.kind) lines.push(`- Tipo de archivo: ${ficha.file.kind}`)
    if (ficha.file?.bytes !== undefined) lines.push(`- Tamaño: ${ficha.file.bytes} bytes`)
    if (ficha.file?.sha256) lines.push(`- SHA-256: \`${ficha.file.sha256}\``)
    lines.push('')
  }
  const libs = importsByLibrary(ficha)
  if (libs.size) {
    lines.push(`## Importaciones (${ficha.imports.length})`, '')
    for (const [lib, names] of libs) lines.push(`- **${lib}**: ${names.slice(0, 60).join(', ')}${names.length > 60 ? ` … (+${names.length - 60})` : ''}`)
    lines.push('')
  }
  if (ficha.exports.length) lines.push(`## Exportaciones (${ficha.exports.length})`, '', ficha.exports.slice(0, 200).join(', '), '')
  if (ficha.functions.length) {
    const named = ficha.functions.filter((fn) => !GENERIC_FN.test(fn.name))
    lines.push(`## Funciones (${ficha.functions.length}, ${named.length} con nombre)`, '')
    for (const fn of named.slice(0, 200)) lines.push(`- \`${fn.name}\`${fn.entry ? ` @ ${fn.entry}` : ''}`)
    lines.push('')
  }
  if (ficha.types.length) {
    lines.push(`## Tipos (${ficha.types.length})`, '', '```c')
    for (const type of ficha.types.slice(0, 100)) lines.push(typeLine(type))
    lines.push('```', '')
  }
  if (ficha.strings.length) {
    lines.push(`## Cadenas (${ficha.strings.length})`, '')
    for (const s of ficha.strings.slice(0, 200)) lines.push(`- ${JSON.stringify(s)}`)
    lines.push('')
  }
  lines.push('## Fuentes', '')
  for (const source of ficha.sources) lines.push(`- ${source.path} (${source.kind})${source.note ? `: ${source.note}` : ''}`)
  if (!ficha.sources.length) lines.push('- Ninguna.')
  return `${lines.join('\n')}\n`
}

export function parseFicha(text: string): Ficha | null {
  try {
    const result = fichaSchema.safeParse(JSON.parse(text))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** Recorta la ficha hasta que su JSON quepa en maxBytes (se escribe con las reglas del proyecto). */
export function fitFicha(ficha: Ficha, maxBytes = 480 * 1024): Ficha {
  const out: Ficha = { ...ficha, functions: [...ficha.functions], imports: [...ficha.imports], exports: [...ficha.exports], types: [...ficha.types], strings: [...ficha.strings] }
  const size = () => Buffer.byteLength(JSON.stringify(out), 'utf8')
  const order: Array<'strings' | 'types' | 'functions' | 'imports' | 'exports'> = ['strings', 'types', 'functions', 'exports', 'imports']
  for (let round = 0; round < 12 && size() > maxBytes; round++) {
    for (const key of order) {
      if (size() <= maxBytes) break
      const list = out[key] as unknown[]
      list.splice(Math.floor(list.length / 2))
    }
  }
  return out
}
