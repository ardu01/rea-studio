import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { findOnPath } from '../src/core/command'
import { agentAnswerSchema, agentStartSchema } from '../src/core/ipc-schemas'
import { ollamaChat, stripThinking, type ChatMessage, type ChatReply } from '../src/core/ollama'
import { AgentSessions } from '../src/core/project/agent-session'
import { extractJsonCall, looksLikeToolJson, parseCall } from '../src/core/project/agent-tools'
import { runAgent, trimContext, type AgentDeps } from '../src/core/project/agent'
import { diffStats, unifiedDiff } from '../src/core/project/diff'
import type { AgentEvent, CommandResult } from '../src/shared/types'

const GIT = findOnPath('git', process.env.PATH ?? '', process.platform)
const temps: string[] = []
async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rea-agente-'))
  temps.push(dir)
  return dir
}
afterEach(async () => {
  while (temps.length) await rm(temps.pop()!, { recursive: true, force: true })
})

describe('diff unificado', () => {
  it('devuelve vacío si no cambia nada y cuenta líneas', () => {
    expect(unifiedDiff('a\nb\n', 'a\nb\n', 'x.txt')).toBe('')
    const diff = unifiedDiff('uno\ndos\ntres\n', 'uno\nDOS\ntres\ncuatro\n', 'src/x.txt')
    expect(diff).toContain('--- a/src/x.txt')
    expect(diff).toContain('-dos')
    expect(diff).toContain('+DOS')
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 })
  })

  it('marca los archivos nuevos', () => {
    const diff = unifiedDiff(null, 'hola\n', 'nuevo.js')
    expect(diff).toContain('--- /dev/null')
    expect(diff).toContain('+hola')
  })

  it.skipIf(!GIT)('git apply acepta el diff generado', async () => {
    const dir = await temp()
    const before = Array.from({ length: 40 }, (_, i) => `línea ${i}`).join('\n') + '\n'
    const after = before.replace('línea 3\n', 'línea tres\n').replace('línea 30\n', '') + 'final\n'
    await writeFile(path.join(dir, 'f.txt'), before)
    execFileSync(GIT!, ['init', '-q'], { cwd: dir })
    await writeFile(path.join(dir, 'p.diff'), unifiedDiff(before, after, 'f.txt'))
    execFileSync(GIT!, ['apply', 'p.diff'], { cwd: dir })
    expect(await readFile(path.join(dir, 'f.txt'), 'utf8')).toBe(after)
  })
})

describe('herramientas del agente', () => {
  const all = ['listar', 'leer', 'escribir', 'editar', 'ejecutar', 'ver_diff', 'fin'] as const
  it('valida los argumentos', () => {
    expect(parseCall('leer', { ruta: 'a.js' }, all).ok).toBe(true)
    expect(parseCall('leer', {}, all).ok).toBe(false)
    expect(parseCall('borrar', { ruta: 'a.js' }, all).ok).toBe(false)
    expect(parseCall('referencia', { consulta: 'x' }, all).ok).toBe(false)
    expect(parseCall('leer', { ruta: 'a.js', extra: 1 }, all).ok).toBe(false)
  })

  it('extrae JSON de herramienta del texto', () => {
    expect(extractJsonCall('Voy a leer:\n```json\n{"herramienta": "leer", "argumentos": {"ruta": "a.js"}}\n```')).toEqual({ name: 'leer', arguments: { ruta: 'a.js' } })
    expect(extractJsonCall('ok {"herramienta":"fin","argumentos":{"resumen":"llaves } en texto"}} fin')).toEqual({ name: 'fin', arguments: { resumen: 'llaves } en texto' } })
    expect(extractJsonCall('nada que hacer')).toBeNull()
    expect(looksLikeToolJson('{"herramienta": "leer", argumentos: roto')).toBe(true)
  })

  it('quita el razonamiento <think>', () => {
    expect(stripThinking('<think>pienso</think>\nHola')).toBe('Hola')
    expect(stripThinking('pienso mucho</think>Hola')).toBe('Hola')
  })

  it('recorta resultados antiguos para caber en el contexto', () => {
    const big = 'x'.repeat(5000)
    const messages: ChatMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'escribir', arguments: { ruta: 'a', contenido: big } } }] },
      { role: 'tool', content: big },
      { role: 'tool', content: big },
      { role: 'tool', content: 'último' },
    ]
    const out = trimContext(messages, 6000)
    expect(out[3]!.content).toContain('recortado')
    expect(out[2]!.tool_calls![0]!.function.arguments.contenido).toBe('[contenido recortado]')
    expect(out[5]!.content).toBe('último')
    expect(messages[3]!.content).toBe(big)
  })

  it('valida los datos IPC del agente', () => {
    expect(agentStartSchema.safeParse({ goal: 'haz algo' }).success).toBe(true)
    expect(agentStartSchema.safeParse({ goal: '' }).success).toBe(false)
    expect(agentAnswerSchema.safeParse({ runId: 'ag-abc-123', callId: 'c3', approve: true }).success).toBe(true)
    expect(agentAnswerSchema.safeParse({ runId: '../x', callId: 'c3', approve: true }).success).toBe(false)
  })
})

function scripted(replies: ChatReply[]) {
  const seen: ChatMessage[][] = []
  const chat = vi.fn(async (messages: ChatMessage[]) => {
    seen.push(messages)
    const next = replies.shift()
    if (!next) return { content: 'Ya está.', toolCalls: [] }
    return next
  })
  return { chat, seen }
}
const call = (name: string, args: unknown): ChatReply => ({ content: '', toolCalls: [{ name, arguments: args }] })
const okResult: CommandResult = { display: 'npm test', status: 'succeeded', exitCode: 0, output: '1 passing', durationMs: 5, logPath: '.rea/salidas/x.log' }

async function setup(extra: Partial<AgentDeps> = {}, replies: ChatReply[] = []) {
  const root = await temp()
  await mkdir(path.join(root, 'src'))
  await writeFile(path.join(root, 'src', 'index.js'), 'export const suma = (a, b) => a - b\n')
  const events: AgentEvent[] = []
  const { chat, seen } = scripted(replies)
  const deps: AgentDeps = {
    root,
    projectName: 'visor-registros',
    templateLabel: 'Node.js',
    commands: [{ command: 'npm', args: ['test'] }],
    chat,
    autonomous: () => false,
    approve: vi.fn(async () => true),
    emit: (event) => events.push(event),
    commit: vi.fn(async () => 'abcdef1234'),
    diff: vi.fn(async () => ''),
    run: vi.fn(async () => okResult),
    ...extra,
  }
  return { root, deps, events, seen, chat }
}

describe('bucle del agente', () => {
  it('lee, edita con permiso, prueba y termina', async () => {
    const { root, deps, events, seen } = await setup({}, [
      call('leer', { ruta: 'src/index.js' }),
      call('editar', { ruta: 'src/index.js', buscar: 'a - b', reemplazar: 'a + b' }),
      call('ejecutar', { comando: 'npm', argumentos: ['test'] }),
      call('fin', { resumen: 'Corregida la suma.' }),
    ])
    const end = await runAgent('arregla la suma', deps, 'ag-1', new AbortController().signal)
    expect(end).toMatchObject({ status: 'finished', text: 'Corregida la suma.' })
    expect(await readFile(path.join(root, 'src', 'index.js'), 'utf8')).toBe('export const suma = (a, b) => a + b\n')
    expect(deps.approve).toHaveBeenCalledTimes(2)
    expect(vi.mocked(deps.approve).mock.calls[0]![1]).toMatchObject({ type: 'write', path: 'src/index.js', added: 1, removed: 1 })
    expect(vi.mocked(deps.approve).mock.calls[1]![1]).toMatchObject({ type: 'command' })
    expect(deps.commit).toHaveBeenCalledWith('modifica src/index.js')
    expect(seen[1]!.at(-1)).toMatchObject({ role: 'tool', tool_name: 'leer' })
    expect(seen[1]!.at(-1)!.content).toContain('a - b')
    expect(seen[0]![0]!.content).toContain('visor-registros')
    expect(seen[0]![1]!.content).toMatch(/src\/\n\s+index.js/)
    expect(events.filter((e) => e.kind === 'tool' && e.status === 'ok')).toHaveLength(3)
  })

  it('respeta un rechazo y no escribe', async () => {
    const { root, deps, seen } = await setup({ approve: vi.fn(async () => false) }, [
      call('escribir', { ruta: 'src/index.js', contenido: 'otra cosa\n' }),
      call('fin', { resumen: 'Nada.' }),
    ])
    await runAgent('cambia', deps, 'ag-1', new AbortController().signal)
    expect(await readFile(path.join(root, 'src', 'index.js'), 'utf8')).toContain('a - b')
    expect(deps.commit).not.toHaveBeenCalled()
    expect(seen[1]!.at(-1)!.content).toContain('rechazó')
  })

  it('en modo autónomo no pregunta, salvo para instalar paquetes', async () => {
    const { root, deps } = await setup({ autonomous: () => true, approve: vi.fn(async () => false) }, [
      call('escribir', { ruta: 'src/nuevo.js', contenido: 'export {}\n' }),
      call('ejecutar', { comando: 'npm', argumentos: ['test'] }),
      call('ejecutar', { comando: 'npm', argumentos: ['install', 'left-pad'] }),
      call('fin', { resumen: 'ok' }),
    ])
    await runAgent('x', deps, 'ag-1', new AbortController().signal)
    expect(await readFile(path.join(root, 'src', 'nuevo.js'), 'utf8')).toBe('export {}\n')
    expect(deps.approve).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.approve).mock.calls[0]![1]).toMatchObject({ type: 'command', check: { kind: 'install' } })
    expect(deps.run).toHaveBeenCalledTimes(1)
  })

  it('no ejecuta comandos fuera de la lista ni escribe fuera del proyecto', async () => {
    const { root, deps, seen } = await setup({ autonomous: () => true }, [
      call('ejecutar', { comando: 'powershell', argumentos: ['-c', 'x'] }),
      call('escribir', { ruta: '../fuera.js', contenido: 'x' }),
      call('escribir', { ruta: 'run.bat', contenido: 'x' }),
      call('fin', { resumen: 'ok' }),
    ])
    await runAgent('x', deps, 'ag-1', new AbortController().signal)
    expect(deps.run).not.toHaveBeenCalled()
    expect(seen[1]!.at(-1)!.content).toContain('No permitido')
    expect(seen[2]!.at(-1)!.content).toMatch(/^Error/)
    expect(seen[3]!.at(-1)!.content).toMatch(/^Error/)
    await expect(readFile(path.join(path.dirname(root), 'fuera.js'))).rejects.toThrow()
  })

  it('acepta llamadas en JSON dentro del texto', async () => {
    const { deps, seen } = await setup({}, [
      { content: '{"herramienta": "listar", "argumentos": {}}', toolCalls: [] },
      { content: '```json\n{"herramienta": "fin", "argumentos": {"resumen": "Listo."}}\n```', toolCalls: [] },
    ])
    const end = await runAgent('x', deps, 'ag-1', new AbortController().signal)
    expect(end.text).toBe('Listo.')
    expect(seen[1]!.at(-1)).toMatchObject({ role: 'user' })
    expect(seen[1]!.at(-1)!.content).toContain('Resultado de listar')
  })

  it('se rinde tras varias herramientas inválidas', async () => {
    const { deps } = await setup({}, [call('borrar', {}), call('borrar', {}), call('borrar', {}), call('borrar', {}), call('borrar', {})])
    const end = await runAgent('x', deps, 'ag-1', new AbortController().signal)
    expect(end.status).toBe('failed')
  })

  it('se para en el límite de pasos', async () => {
    const replies = Array.from({ length: 10 }, () => call('listar', {}))
    const { deps } = await setup({ limits: { maxSteps: 3 } }, replies)
    const end = await runAgent('x', deps, 'ag-1', new AbortController().signal)
    expect(end.status).toBe('limit')
  })

  it('se detiene al cancelar', async () => {
    const controller = new AbortController()
    const { deps } = await setup({
      chat: async (_m, _t, signal) => {
        controller.abort()
        expect(signal.aborted).toBe(true)
        return call('listar', {})
      },
    })
    const end = await runAgent('x', deps, 'ag-1', controller.signal)
    expect(end.status).toBe('cancelled')
  })
})

describe('sesiones del agente', () => {
  it('pide aprobación por evento, la recibe y cambia a JSON si el modelo no admite herramientas', async () => {
    const events: AgentEvent[] = []
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => (resolveEnd = resolve))
    const sessions = new AgentSessions((event) => {
      events.push(event)
      if (event.kind === 'approval') sessions.answer(event.runId, event.callId, true)
      if (event.kind === 'end') resolveEnd()
    })
    const { deps, root } = await setup()
    const replies: ChatReply[] = [
      { content: '{"herramienta":"escribir","argumentos":{"ruta":"src/b.js","contenido":"b\\n"}}', toolCalls: [] },
      { content: '{"herramienta":"fin","argumentos":{"resumen":"hecho"}}', toolCalls: [] },
    ]
    const chat = vi.fn(async (_m: ChatMessage[], tools: unknown) => {
      if (tools) throw new Error('NO_TOOLS')
      return replies.shift()!
    })
    const { approve: _a, emit: _e, chat: _c, ...rest } = deps
    const runId = sessions.start('x', { ...rest, chat }, 'modelo-local')
    expect(sessions.running).toBe(runId)
    expect(() => sessions.start('y', { ...rest, chat }, 'm')).toThrow(/ya está trabajando/)
    await ended
    expect(await readFile(path.join(root, 'src', 'b.js'), 'utf8')).toBe('b\n')
    expect(events.some((e) => e.kind === 'message' && e.text.includes('JSON'))).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'end', status: 'finished' })
    expect(sessions.running).toBeNull()
  })

  it('al detener, las aprobaciones pendientes cuentan como rechazo', async () => {
    let resolveEnd!: () => void
    const ended = new Promise<void>((resolve) => (resolveEnd = resolve))
    const events: AgentEvent[] = []
    const sessions = new AgentSessions((event) => {
      events.push(event)
      if (event.kind === 'approval') sessions.cancel(event.runId)
      if (event.kind === 'end') resolveEnd()
    })
    const { deps, root } = await setup()
    const { approve: _a, emit: _e, chat: _c, ...rest } = deps
    sessions.start('x', { ...rest, chat: async () => call('escribir', { ruta: 'src/c.js', contenido: 'c' }) }, 'm')
    await ended
    expect(events.at(-1)).toMatchObject({ kind: 'end', status: 'cancelled' })
    await expect(readFile(path.join(root, 'src', 'c.js'))).rejects.toThrow()
  })
})

describe('ollamaChat', () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  it('solo habla con localhost', async () => {
    const fetchImpl = vi.fn()
    await expect(ollamaChat({ endpoint: 'https://api.example.com/v1', model: 'm', messages: [], fetchImpl })).rejects.toThrow()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('envía herramientas sin streaming y lee tool_calls', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      ok({ message: { content: '<think>x</think>Leo', tool_calls: [{ function: { name: 'leer', arguments: '{"ruta":"a.js"}' } }, { function: { name: 'fin', arguments: { resumen: 'r' } } }] } }),
    )
    const reply = await ollamaChat({
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M',
      messages: [{ role: 'user', content: 'hola' }],
      tools: [{ type: 'function', function: { name: 'leer', description: 'd', parameters: {} } }],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl.mock.calls[0]![0]).toBe('http://127.0.0.1:11434/api/chat')
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect(body.stream).toBe(false)
    expect(body.tools).toHaveLength(1)
    expect(reply).toEqual({ content: 'Leo', toolCalls: [{ name: 'leer', arguments: { ruta: 'a.js' } }, { name: 'fin', arguments: { resumen: 'r' } }] })
  })

  it('traduce los errores de Ollama', async () => {
    const make = (error: string, status = 400) => vi.fn(async () => new Response(JSON.stringify({ error }), { status })) as unknown as typeof fetch
    const base = { endpoint: 'http://localhost:11434', model: 'llama3.2', messages: [] }
    await expect(ollamaChat({ ...base, fetchImpl: make('model "llama3.2" not found, try pulling it first', 404) })).rejects.toThrow(/no está instalado/)
    await expect(ollamaChat({ ...base, fetchImpl: make('registry.ollama.ai/library/llama3.2 does not support tools') })).rejects.toThrow('NO_TOOLS')
    await expect(ollamaChat({ ...base, fetchImpl: make('boom', 500) })).rejects.toThrow(/HTTP 500/)
  })
})
