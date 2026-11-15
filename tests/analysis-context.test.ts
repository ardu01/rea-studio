import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ghidraArgv } from '../src/core/adapters'
import { findOnPath } from '../src/core/command'
import { referencesUpdateSchema } from '../src/core/ipc-schemas'
import { runAgent } from '../src/core/project/agent'
import {
  buildFicha,
  collectSymbols,
  fichaMarkdown,
  fichaSummary,
  filterStrings,
  fitFicha,
  parseFicha,
  redactUserPaths,
  searchFicha,
  type Ficha,
} from '../src/core/project/analysis-context'
import { processGitRunner } from '../src/core/project/git'
import { ProjectService } from '../src/core/project/service'

const GIT = findOnPath('git', process.env.PATH ?? '', process.platform)
const temps: string[] = []
async function temp(prefix = 'rea-ficha-'): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true })
})

async function sampleWorkspace(): Promise<string> {
  const ws = await temp('rea-ws-')
  const out = path.join(ws, 'jobs', 'j1', 'output')
  await mkdir(out, { recursive: true })
  await writeFile(
    path.join(out, 'ghidra-summary.json'),
    JSON.stringify({
      name: 'visor.exe',
      language: 'x86:LE:64:default',
      compiler: 'windows',
      imageBase: '140000000',
      format: 'Portable Executable (PE)',
      functionCount: 3,
      functions: [
        { name: 'entry', entry: '140001000' },
        { name: 'FUN_140001200', entry: '140001200' },
        { name: 'parse_registro', entry: '140001400' },
      ],
      truncated: false,
    }),
  )
  await writeFile(
    path.join(out, 'ghidra-types.json'),
    JSON.stringify({
      types: [
        { name: 'Registro', category: '/visor', size: 16, kind: 'struct', fields: [{ name: 'id', type: 'uint', offset: 0, size: 4 }, { name: 'valor', type: 'double', offset: 8, size: 8 }], truncated: false },
        { name: 'Nivel', category: '/visor', size: 4, kind: 'enum', values: [{ name: 'INFO', value: 0 }, { name: 'ERROR', value: 2 }], truncated: false },
        { name: 'roto', kind: 'otra' },
      ],
      total: 3,
      truncated: false,
    }),
  )
  await writeFile(path.join(out, 'strings.txt'), ['abc', 'Abriendo registro %s', 'Abriendo registro %s', 'C:\\Users\\ana\\Documents\\datos.log', '@@@@@@@@@@', 'xQzv7Kp', '0x0040a0f3'].join('\n'))
  await writeFile(path.join(out, 'metadata.json'), JSON.stringify({ path: '/home/ana/muestras/visor.exe', bytes: 48128, sha256: 'a'.repeat(64), kind: 'PE (MZ)' }))
  await mkdir(path.join(ws, 'jobs', 'j2'), { recursive: true })
  await writeFile(
    path.join(ws, 'jobs', 'j2', 'stdout.log'),
    JSON.stringify({ info: { arch: 'x86' }, imports: [{ name: 'CreateFileW', libname: 'KERNEL32.dll' }, { name: 'ReadFile', libname: 'KERNEL32.dll' }], exports: [{ name: 'VisorAbrir' }] }),
  )
  await writeFile(path.join(ws, 'jobs', 'j2', 'notas.log'), 'texto libre\n')
  return ws
}

const REFS = [
  'jobs/j1/output/ghidra-summary.json',
  'jobs/j1/output/ghidra-types.json',
  'jobs/j1/output/strings.txt',
  'jobs/j1/output/metadata.json',
  'jobs/j2/stdout.log',
  'jobs/j2/notas.log',
  '../fuera.json',
]

describe('ficha del análisis', () => {
  it('reúne Ghidra, tipos, cadenas, metadatos e importaciones', async () => {
    const ficha = await buildFicha(await sampleWorkspace(), REFS)
    expect(ficha.program).toMatchObject({ name: 'visor.exe', format: 'Portable Executable (PE)', functionCount: 3 })
    expect(ficha.functions.map((fn) => fn.name)).toEqual(['entry', 'FUN_140001200', 'parse_registro'])
    expect(ficha.types.map((t) => t.name)).toEqual(['Registro', 'Nivel'])
    expect(ficha.imports).toEqual([
      { library: 'KERNEL32.dll', name: 'CreateFileW' },
      { library: 'KERNEL32.dll', name: 'ReadFile' },
    ])
    expect(ficha.exports).toEqual(['VisorAbrir'])
    expect(ficha.file).toEqual({ name: 'visor.exe', kind: 'PE (MZ)', bytes: 48128, sha256: 'a'.repeat(64) })
    expect(ficha.strings).toContain('Abriendo registro %s')
    expect(ficha.strings.filter((s) => s === 'Abriendo registro %s')).toHaveLength(1)
    expect(ficha.strings.join('\n')).not.toContain('ana')
    expect(ficha.strings).not.toContain('@@@@@@@@@@')
    expect(ficha.sources.find((s) => s.path === '../fuera.json')).toMatchObject({ kind: 'omitido' })
    expect(ficha.sources.find((s) => s.path === 'jobs/j2/notas.log')).toMatchObject({ kind: 'omitido' })
    const md = fichaMarkdown(ficha)
    expect(md).toContain('## Importaciones (2)')
    expect(md).toContain('struct Registro (16 bytes) { +0 uint id; +8 double valor }')
    expect(md).toContain('`parse_registro` @ 140001400')
    expect(md).not.toContain('FUN_140001200')
    expect(md).not.toMatch(/home\/ana|Users\\ana/)
    expect(parseFicha(JSON.stringify(ficha))).toEqual(ficha)
    expect(parseFicha('{"version": 2}')).toBeNull()
  })

  it('busca en todas las secciones y resume', async () => {
    const ficha = await buildFicha(await sampleWorkspace(), REFS)
    expect(searchFicha(ficha, 'registro')).toMatch(/Funciones \(1\):\n  parse_registro @ 140001400/)
    expect(searchFicha(ficha, 'registro')).toContain('Tipos (1)')
    expect(searchFicha(ficha, 'registro')).toContain('Cadenas (1)')
    expect(searchFicha(ficha, 'kernel32 readfile')).toContain('KERNEL32.dll!ReadFile')
    expect(searchFicha(ficha, 'zzz')).toMatch(/Nada en la ficha/)
    const summary = fichaSummary(ficha)
    expect(summary).toContain('visor.exe')
    expect(summary).toContain('parse_registro')
    expect(summary).not.toContain('FUN_140001200')
  })

  it('quita rutas de usuario', () => {
    expect(redactUserPaths('C:\\Users\\ana\\x.txt y /home/luis/y y /Users/eva/z')).toBe('C:\\Users\\<usuario>\\x.txt y /home/<usuario>/y y /Users/<usuario>/z')
    expect(filterStrings(['GetProcAddress', 'GetProcAddress', 'aaaaaaa', '1234567'])).toEqual(['GetProcAddress'])
  })

  it('entiende importaciones agrupadas por biblioteca', () => {
    const ficha: Ficha = { version: 1, generatedAt: '', sources: [], functions: [], imports: [], exports: [], types: [], strings: [] }
    collectSymbols({ pe: { imports: { 'USER32.dll': ['MessageBoxW'], 'WS2_32.dll': [{ name: 'connect' }] } } }, ficha)
    expect(ficha.imports).toEqual([
      { library: 'USER32.dll', name: 'MessageBoxW' },
      { library: 'WS2_32.dll', name: 'connect' },
    ])
  })

  it('recorta una ficha enorme para que quepa', () => {
    const ficha: Ficha = {
      version: 1,
      generatedAt: '',
      sources: [],
      functions: Array.from({ length: 2000 }, (_, i) => ({ name: `funcion_larga_numero_${i}`, entry: `1400${i}` })),
      imports: Array.from({ length: 3000 }, (_, i) => ({ library: 'KERNEL32.dll', name: `Importacion${i}` })),
      exports: [],
      types: [],
      strings: Array.from({ length: 1500 }, (_, i) => `cadena de ejemplo bastante larga para ocupar espacio ${i}`.repeat(3)),
    }
    const fitted = fitFicha(ficha, 120 * 1024)
    expect(Buffer.byteLength(JSON.stringify(fitted))).toBeLessThanOrEqual(120 * 1024)
    expect(fitted.functions.length).toBeGreaterThan(0)
    expect(ficha.strings).toHaveLength(1500)
  })

  it('Ghidra exporta también los tipos', () => {
    const args = ghidraArgv({ projectDir: '/w/p', target: '/s/a.exe', scriptDir: '/r/ghidra', summaryPath: '/w/o/ghidra-summary.json', typesPath: '/w/o/ghidra-types.json', logPath: '/w/o/g.log', timeoutSec: 60 })
    expect(args.slice(args.indexOf('ExportTypes.java') - 1, args.indexOf('ExportTypes.java') + 2)).toEqual(['-postScript', 'ExportTypes.java', '/w/o/ghidra-types.json'])
    const script = readFileSync('resources/ghidra/ExportTypes.java', 'utf8')
    expect(script).toContain('class ExportTypes')
    expect(script).not.toContain('Runtime.getRuntime')
    expect(script).not.toContain('ProcessBuilder')
  })

  it('valida la IPC de referencias', () => {
    expect(referencesUpdateSchema.safeParse({}).success).toBe(true)
    expect(referencesUpdateSchema.safeParse({ references: ['jobs/a/strings.txt'] }).success).toBe(true)
    expect(referencesUpdateSchema.safeParse({ references: 'x' }).success).toBe(false)
  })
})

describe('el agente y la referencia', () => {
  it('no puede escribir en referencia/', async () => {
    const root = await temp()
    const replies = [
      { content: '', toolCalls: [{ name: 'escribir', arguments: { ruta: 'referencia/ficha.md', contenido: 'x' } }] },
      { content: '', toolCalls: [{ name: 'referencia', arguments: { consulta: 'registro' } }] },
      { content: '', toolCalls: [{ name: 'fin', arguments: { resumen: 'ok' } }] },
    ]
    const seen: string[] = []
    const reference = vi.fn(async (q: string) => `resultado para ${q}`)
    await runAgent(
      'x',
      {
        root,
        projectName: 'p',
        templateLabel: 'Node.js',
        commands: [],
        chat: async (messages) => {
          seen.push(messages.at(-1)!.content)
          return replies.shift()!
        },
        autonomous: () => true,
        approve: async () => true,
        emit: () => undefined,
        commit: async () => null,
        diff: async () => '',
        run: async () => {
          throw new Error('no')
        },
        reference,
        referenceSummary: 'Programa: visor.exe',
      },
      'ag-1',
      new AbortController().signal,
    )
    expect(seen[0]).toContain('Programa: visor.exe')
    expect(seen[1]).toMatch(/solo lectura/)
    expect(seen[2]).toBe('resultado para registro')
    expect(existsSync(path.join(root, 'referencia'))).toBe(false)
  })
})

describe.skipIf(!GIT)('ficha en el proyecto (git real)', () => {
  it('se genera al crear con referencias, se puede regenerar y queda en el historial', async () => {
    const ws = await sampleWorkspace()
    const parent = await temp()
    const projects = new ProjectService({ gitFor: (root) => processGitRunner(GIT!, root), workspace: () => ws })
    const info = await projects.create({ parentDir: parent, name: 'visor', template: 'node', references: REFS.slice(0, 2) })
    expect(existsSync(path.join(info.root, 'referencia', 'ficha.md'))).toBe(true)
    expect((await projects.ficha())?.functions).toHaveLength(3)
    let history = await projects.history()
    expect(history[0]!.message).toBe('REA: actualiza la ficha del análisis')
    await projects.updateReferences(REFS.slice(0, 5))
    expect(projects.project?.references).toHaveLength(5)
    expect(JSON.parse(await readFile(path.join(info.root, 'rea-proyecto.json'), 'utf8')).references).toHaveLength(5)
    expect((await projects.ficha())?.imports).toHaveLength(2)
    history = await projects.history()
    expect(history).toHaveLength(3)
    expect(await projects.git().isClean()).toBe(true)
  })

  it('sin espacio de trabajo no genera nada', async () => {
    const parent = await temp()
    const projects = new ProjectService({ gitFor: (root) => processGitRunner(GIT!, root), workspace: () => null })
    await projects.create({ parentDir: parent, name: 'solo', template: 'python', references: [] })
    await expect(projects.updateReferences()).rejects.toThrow(/espacio de trabajo/)
    expect(await projects.ficha()).toBeNull()
  })
})
