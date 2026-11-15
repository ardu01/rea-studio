import type { AgentApproval, AgentEvent, CommandCheck, CommandResult } from '../../shared/types.js'
import type { ChatMessage, ChatReply, ToolSpec } from '../ollama.js'
import { extractJsonCall, looksLikeToolJson, parseCall, toolSpecs, type ToolName } from './agent-tools.js'
import { diffStats, unifiedDiff } from './diff.js'
import { ALLOWED_COMMANDS, classifyCommand, needsApproval, outputForModel } from './exec.js'
import { applyEdit, assertWritable, listProjectTree, readProjectFile, treeSummary, writeProjectFile } from './fs.js'

export interface AgentLimits {
  /** Llamadas a herramientas como máximo por objetivo. */
  maxSteps: number
  /** Respuestas seguidas sin herramienta válida antes de parar. */
  maxInvalid: number
  /** Caracteres máximos de un resultado de herramienta que vuelve al modelo. */
  maxToolChars: number
  /** Caracteres aproximados de toda la conversación antes de recortar resultados antiguos. */
  maxContextChars: number
}

/** Valores provisionales: se ajustan tras medir en la torre (fase 0). */
export const DEFAULT_LIMITS: AgentLimits = { maxSteps: 25, maxInvalid: 3, maxToolChars: 6000, maxContextChars: 48_000 }

export interface AgentDeps {
  root: string
  projectName: string
  templateLabel: string
  commands: Array<{ command: string; args: string[] }>
  chat: (messages: ChatMessage[], tools: ToolSpec[], signal: AbortSignal) => Promise<ChatReply>
  autonomous: () => boolean
  approve: (callId: string, request: AgentApproval) => Promise<boolean>
  emit: (event: AgentEvent) => void
  commit: (message: string) => Promise<string | null>
  diff: () => Promise<string>
  run: (check: CommandCheck, signal: AbortSignal) => Promise<CommandResult>
  /** Fase 4: búsqueda en la ficha del análisis. */
  reference?: (query: string) => Promise<string>
  /** Contexto de la ficha del análisis del original (se inyecta siempre en el primer mensaje). */
  analysis?: string
  limits?: Partial<AgentLimits>
}

export const RECREATE_INSTRUCTIONS = [
  'Tu trabajo es copiar el programa original descrito en la ficha del análisis y después mejorarlo, en dos fases separadas:',
  'FASE 1, REPRODUCCIÓN FIEL. Reproduce la aplicación original tal como la describe la ficha: las mismas funciones y responsabilidades, los mismos formatos de archivo y estructuras de datos (tipos, campos, tamaños y orden), los mismos mensajes y cadenas visibles, el mismo comportamiento y la misma estructura de módulos. En esta fase no añadas, quites ni corrijas nada, aunque parezca un error del original. Escribe pruebas que comprueben ese comportamiento. Marca cada cambio con fase="reproduccion".',
  'FASE 2, MEJORAS. Solo cuando la reproducción esté completa y sus pruebas pasen, escribe un mensaje que empiece por «FASE 2» y mejora la copia: errores, rendimiento, seguridad e interfaz. Cada mejora es un cambio aparte con fase="mejora" y un motivo que explique qué mejora y por qué. Mantén la compatibilidad con los formatos de archivo del original salvo que el motivo explique lo contrario.',
  'Si la ficha no dice algo, búscalo con «referencia» antes de suponer. Si sigue sin saberse, elige lo más sencillo y dilo en el resumen.',
  'Al terminar, llama a «fin» con dos apartados: «Reproducción» (qué partes del original están y cuáles faltan) y «Mejoras» (cada una con su motivo).',
].join('\n')

export function systemPrompt(deps: AgentDeps, tools: readonly ToolName[]): string {
  const commands = deps.commands.map((item) => `${item.command} ${item.args.join(' ')}`).join('\n  ')
  return [
    `Eres el agente de programación de REA Studio. Trabajas solo dentro de la carpeta del proyecto «${deps.projectName}» (plantilla ${deps.templateLabel}).`,
    'Usa las herramientas para leer, crear y modificar archivos y para ejecutar la compilación y las pruebas. Las rutas son relativas a la raíz del proyecto.',
    `Solo puedes ejecutar estos programas, sin shell: ${ALLOWED_COMMANDS.join(', ')}. Instalar paquetes necesita el permiso del usuario.`,
    `Comandos de compilación y pruebas del proyecto:\n  ${commands}`,
    'Trabaja en pasos pequeños: lee antes de editar, después de cambiar código ejecuta las pruebas, lee los errores y corrígelos.',
    deps.analysis ? RECREATE_INSTRUCTIONS : 'Cuando termines, llama a «fin» con un resumen breve en español de lo que has hecho.',
    `Herramientas: ${tools.join(', ')}. Si no puedes hacer llamadas a herramientas, responde SOLO con un objeto JSON así: {"herramienta": "leer", "argumentos": {"ruta": "src/index.js"}}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const half = Math.floor(max / 2)
  return `${text.slice(0, half)}\n[… recortado …]\n${text.slice(-half)}`
}

function sizeOf(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length + JSON.stringify(message.tool_calls ?? '').length, 0)
}

/** Recorta los resultados de herramientas más antiguos hasta caber en el presupuesto. */
export function trimContext(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  const out = messages.map((message) => ({ ...message }))
  for (let i = 2; i < out.length - 2 && sizeOf(out) > maxChars; i++) {
    const message = out[i]!
    if (message.role === 'tool' && message.content.length > 200) message.content = '[resultado antiguo recortado para ahorrar contexto]'
    if (message.role === 'assistant' && message.tool_calls) {
      for (const call of message.tool_calls) {
        if (typeof call.function.arguments.contenido === 'string' && call.function.arguments.contenido.length > 200) {
          call.function = { ...call.function, arguments: { ...call.function.arguments, contenido: '[contenido recortado]' } }
        }
      }
    }
  }
  return out
}

function describe(name: string, args: Record<string, unknown>): string {
  if (name === 'ejecutar') return `ejecutar(${[args.comando, ...((args.argumentos as string[] | undefined) ?? [])].join(' ')})`
  if (name === 'fin') return 'fin'
  const first = args.ruta ?? args.consulta
  return `${name}(${first === undefined ? '' : JSON.stringify(first)})`
}

export async function runAgent(goal: string, deps: AgentDeps, runId: string, signal: AbortSignal): Promise<AgentEvent & { kind: 'end' }> {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits }
  const enabled: ToolName[] = ['listar', 'leer', 'escribir', 'editar', 'ejecutar', 'ver_diff', 'fin']
  if (deps.reference) enabled.splice(6, 0, 'referencia')
  const specs = toolSpecs(enabled)
  const tree = await listProjectTree(deps.root, { maxEntries: 400 })
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(deps, enabled) },
    {
      role: 'user',
      content: [`Objetivo: ${goal}`, `Árbol del proyecto:\n${treeSummary(tree.entries)}`, deps.analysis ? `Ficha del análisis del programa original (es la base de la copia; síguela con fidelidad):\n${deps.analysis}` : '']
        .filter(Boolean)
        .join('\n\n'),
    },
  ]
  let steps = 0
  let invalid = 0
  let callSeq = 0
  const end = (status: 'finished' | 'cancelled' | 'failed' | 'limit', text: string) => {
    const event = { kind: 'end' as const, runId, status, text }
    deps.emit(event)
    return event
  }

  try {
    for (;;) {
      if (signal.aborted) return end('cancelled', 'Detenido por el usuario.')
      deps.emit({ kind: 'thinking', runId, step: steps })
      const reply = await deps.chat(trimContext(messages, limits.maxContextChars), specs, signal)
      if (signal.aborted) return end('cancelled', 'Detenido por el usuario.')
      let calls = reply.toolCalls
      let viaJson = false
      if (calls.length === 0) {
        const json = extractJsonCall(reply.content)
        if (json) {
          calls = [json]
          viaJson = true
        }
      }
      if (calls.length === 0) {
        if (looksLikeToolJson(reply.content) && invalid < limits.maxInvalid) {
          invalid++
          messages.push({ role: 'assistant', content: reply.content })
          messages.push({ role: 'user', content: 'Tu JSON no es válido. Responde solo con {"herramienta": "...", "argumentos": {...}}.' })
          continue
        }
        if (reply.content.trim()) deps.emit({ kind: 'message', runId, text: reply.content })
        return end('finished', reply.content.trim() || 'El modelo terminó sin resumen.')
      }
      if (reply.content.trim() && !viaJson) deps.emit({ kind: 'message', runId, text: reply.content })
      messages.push(
        viaJson
          ? { role: 'assistant', content: reply.content }
          : { role: 'assistant', content: reply.content, tool_calls: calls.map((call) => ({ function: { name: call.name, arguments: (call.arguments ?? {}) as Record<string, unknown> } })) },
      )
      for (const call of calls) {
        if (signal.aborted) return end('cancelled', 'Detenido por el usuario.')
        const callId = `c${++callSeq}`
        const parsed = parseCall(call.name, call.arguments, enabled)
        const reply = (content: string) =>
          messages.push(viaJson ? { role: 'user', content: `Resultado de ${call.name}:\n${content}` } : { role: 'tool', tool_name: call.name, content })
        if (!parsed.ok) {
          invalid++
          deps.emit({ kind: 'tool', runId, callId, tool: call.name, summary: call.name, status: 'error', detail: parsed.error })
          reply(parsed.error)
          if (invalid > limits.maxInvalid) return end('failed', 'El modelo ha pedido varias herramientas inválidas seguidas. Prueba con un objetivo más concreto.')
          continue
        }
        invalid = 0
        steps++
        if (steps > limits.maxSteps) return end('limit', `Se llegó al máximo de ${limits.maxSteps} pasos. Revisa lo hecho y pide el siguiente paso.`)
        if (parsed.name === 'fin') {
          const summary = String(parsed.args.resumen ?? '').trim()
          return end('finished', summary || 'Terminado.')
        }
        const summary = describe(parsed.name, parsed.args)
        deps.emit({ kind: 'tool', runId, callId, tool: parsed.name, summary, status: 'running' })
        try {
          const outcome = await execute(parsed.name, parsed.args, callId)
          deps.emit({ kind: 'tool', runId, callId, tool: parsed.name, summary, status: outcome.rejected ? 'rejected' : 'ok', detail: outcome.detail })
          reply(clip(outcome.text, limits.maxToolChars))
        } catch (error) {
          if (signal.aborted) return end('cancelled', 'Detenido por el usuario.')
          const text = error instanceof Error ? error.message : 'Error'
          deps.emit({ kind: 'tool', runId, callId, tool: parsed.name, summary, status: 'error', detail: text })
          reply(`Error: ${text}`)
        }
      }
    }
  } catch (error) {
    if (signal.aborted) return end('cancelled', 'Detenido por el usuario.')
    return end('failed', error instanceof Error ? error.message : 'El agente falló.')
  }

  async function execute(name: ToolName, args: Record<string, unknown>, callId: string): Promise<{ text: string; detail?: string; rejected?: boolean }> {
    switch (name) {
      case 'listar': {
        const tree = await listProjectTree(deps.root, { maxEntries: 400 })
        const prefix = typeof args.ruta === 'string' ? args.ruta.replace(/\\/g, '/').replace(/\/+$/, '') : ''
        const entries = prefix ? tree.entries.filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`)) : tree.entries
        return { text: treeSummary(entries, 200) || '(vacío)' }
      }
      case 'leer': {
        const file = await readProjectFile(deps.root, String(args.ruta))
        if (file.binary) return { text: 'Es un archivo binario; no se puede leer como texto.' }
        const lines = file.text.split('\n')
        const from = Math.max(1, Number(args.desde ?? 1))
        const to = Math.min(lines.length, Number(args.hasta ?? lines.length))
        const body = lines.slice(from - 1, to).map((line, i) => `${String(from + i).padStart(4)}| ${line}`).join('\n')
        return { text: `${file.relativePath} (líneas ${from}-${to} de ${lines.length})\n${body}` }
      }
      case 'escribir':
      case 'editar': {
        const path = String(args.ruta)
        if (/^referencia(\/|$)/i.test(assertWritable(path))) throw new Error('La carpeta referencia/ es de solo lectura: la genera REA Studio a partir del análisis.')
        let previous: string | null = null
        try {
          const file = await readProjectFile(deps.root, path)
          if (file.binary) throw new Error('No se edita un archivo binario.')
          if (file.truncated) throw new Error('El archivo es demasiado grande para editarlo entero.')
          previous = file.text
        } catch (error) {
          if (!(error instanceof Error && error.message.startsWith('No existe'))) throw error
        }
        let next: string
        if (name === 'editar') {
          if (previous === null) throw new Error(`No existe ${path}. Usa escribir para crearlo.`)
          next = applyEdit(previous, String(args.buscar), String(args.reemplazar))
        } else {
          next = String(args.contenido)
        }
        const phase = args.fase as 'reproduccion' | 'mejora' | undefined
        const reason = typeof args.motivo === 'string' ? args.motivo.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
        if (phase === 'mejora' && !reason) throw new Error('Cada mejora necesita un motivo: explica qué mejora y por qué.')
        const diff = unifiedDiff(previous, next, path)
        if (!diff) return { text: 'Sin cambios: el contenido es el mismo.' }
        const stats = diffStats(diff)
        if (!deps.autonomous()) {
          const ok = await deps.approve(callId, { type: 'write', path, diff, created: previous === null, ...stats, ...(phase ? { phase } : {}), ...(reason ? { reason } : {}) })
          if (!ok) return { text: 'El usuario rechazó este cambio. No insistas con lo mismo; pregunta o prueba otra cosa.', rejected: true, detail: diff }
        }
        await writeProjectFile(deps.root, path, next)
        const action = `${previous === null ? 'crea' : 'modifica'} ${path}`
        const hash = await deps.commit(phase === 'mejora' ? `mejora: ${action} (${reason})` : phase === 'reproduccion' ? `reproduce: ${action}` : action)
        return { text: `Hecho: ${path} (+${stats.added} −${stats.removed}).`, detail: diff + (hash ? `\ncommit ${hash.slice(0, 8)}` : '') }
      }
      case 'ejecutar': {
        const check = classifyCommand(String(args.comando), (args.argumentos as string[] | undefined) ?? [], deps.root)
        if (!check.allowed) return { text: `No permitido: ${check.reason}` , rejected: true, detail: check.reason }
        if (needsApproval(check, deps.autonomous())) {
          const ok = await deps.approve(callId, { type: 'command', check })
          if (!ok) return { text: `El usuario no ha permitido ejecutar «${check.display}».`, rejected: true }
        }
        const result = await deps.run(check, signal)
        await deps.commit(`ejecuta ${check.display}`)
        return { text: outputForModel(result), detail: result.output }
      }
      case 'ver_diff': {
        const diff = await deps.diff()
        return { text: diff.trim() ? diff : 'No hay cambios sin guardar.' }
      }
      case 'referencia': {
        if (!deps.reference) return { text: 'No hay ficha del análisis en este proyecto.' }
        return { text: await deps.reference(String(args.consulta)) }
      }
      default:
        return { text: 'Herramienta no disponible.' }
    }
  }
}
