import type { AgentApproval, AgentEvent } from '../../shared/types.js'
import type { ChatMessage, ChatReply, ToolSpec } from '../ollama.js'
import { runAgent, type AgentDeps } from './agent.js'

type SessionDeps = Omit<AgentDeps, 'approve' | 'emit' | 'chat'> & {
  chat: (messages: ChatMessage[], tools: ToolSpec[] | undefined, signal: AbortSignal) => Promise<ChatReply>
}

/** Una ejecución del agente con sus aprobaciones pendientes. Solo hay una a la vez. */
export class AgentSessions {
  private active: { runId: string; controller: AbortController; pending: Map<string, (ok: boolean) => void> } | null = null

  constructor(private readonly emit: (event: AgentEvent) => void) {}

  get running(): string | null {
    return this.active?.runId ?? null
  }

  start(goal: string, deps: SessionDeps, model: string): string {
    if (this.active) throw new Error('El agente ya está trabajando. Espera o detenlo.')
    const runId = `ag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const controller = new AbortController()
    const pending = new Map<string, (ok: boolean) => void>()
    this.active = { runId, controller, pending }
    let toolsSupported = true
    this.emit({ kind: 'start', runId, goal, model })
    void runAgent(
      goal,
      {
        ...deps,
        emit: this.emit,
        chat: async (messages, tools, signal) => {
          if (toolsSupported) {
            try {
              return await deps.chat(messages, tools, signal)
            } catch (error) {
              if (!(error instanceof Error && error.message === 'NO_TOOLS')) throw error
              toolsSupported = false
              this.emit({ kind: 'message', runId, text: 'Este modelo no admite llamadas a herramientas en Ollama; sigo con el formato JSON.' })
            }
          }
          return deps.chat(messages, undefined, signal)
        },
        approve: (callId: string, request: AgentApproval) =>
          new Promise<boolean>((resolve) => {
            if (controller.signal.aborted) return resolve(false)
            pending.set(callId, resolve)
            this.emit({ kind: 'approval', runId, callId, request })
          }),
      },
      runId,
      controller.signal,
    ).finally(() => {
      for (const resolve of pending.values()) resolve(false)
      if (this.active?.runId === runId) this.active = null
    })
    return runId
  }

  answer(runId: string, callId: string, approve: boolean): void {
    if (this.active?.runId !== runId) throw new Error('Esa ejecución del agente ya terminó.')
    const resolve = this.active.pending.get(callId)
    if (!resolve) throw new Error('No hay nada pendiente con ese identificador.')
    this.active.pending.delete(callId)
    resolve(approve)
  }

  cancel(runId: string): void {
    if (this.active?.runId !== runId) return
    this.active.controller.abort()
    for (const resolve of this.active.pending.values()) resolve(false)
    this.active.pending.clear()
  }
}
