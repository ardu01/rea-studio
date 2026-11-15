import { useEffect, useRef, useState } from 'react'
import type { AgentApproval, AgentEvent } from '../../shared/types'
import type { ProjectContext } from './project'
import { DiffView } from './project'
import { CommandConfirm, OutputView } from './project-commands'
import { Area, Badge, Button } from './ui'

type LogItem =
  | { type: 'goal'; text: string }
  | { type: 'message'; text: string }
  | { type: 'tool'; callId: string; summary: string; status: 'running' | 'ok' | 'error' | 'rejected'; detail?: string; tool: string }
  | { type: 'end'; status: string; text: string }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción.'
}

const STATUS_LABEL: Record<string, string> = { running: 'en curso', ok: 'hecho', error: 'error', rejected: 'rechazado' }
const END_LABEL: Record<string, string> = { finished: 'Terminado', cancelled: 'Detenido', failed: 'Falló', limit: 'Límite de pasos' }

export function AgentPanel({ ctx }: { ctx: ProjectContext }) {
  const { bridge, view } = ctx
  const project = view.project!
  const agent = view.agent
  const [goal, setGoal] = useState('')
  const [runId, setRunId] = useState<string | null>(agent?.running ?? null)
  const [log, setLog] = useState<LogItem[]>([])
  const [pending, setPending] = useState<{ callId: string; request: AgentApproval } | null>(null)
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const runRef = useRef<string | null>(agent?.running ?? null)

  useEffect(() => {
    return bridge.onAgentEvent((event: AgentEvent) => {
      if (event.kind === 'start') {
        runRef.current = event.runId
        setRunId(event.runId)
        return
      }
      if (event.runId !== runRef.current) return
      if (event.kind === 'thinking') setThinking(true)
      if (event.kind === 'message') {
        setThinking(false)
        setLog((prev) => [...prev, { type: 'message', text: event.text }])
      }
      if (event.kind === 'tool') {
        setThinking(false)
        setLog((prev) => {
          const index = prev.findIndex((item) => item.type === 'tool' && item.callId === event.callId)
          const item: LogItem = { type: 'tool', callId: event.callId, summary: event.summary, status: event.status, detail: event.detail, tool: event.tool }
          if (index === -1) return [...prev, item]
          const next = [...prev]
          next[index] = item
          return next
        })
        if (event.status !== 'running') void ctx.refresh()
      }
      if (event.kind === 'approval') {
        setThinking(false)
        setPending({ callId: event.callId, request: event.request })
      }
      if (event.kind === 'end') {
        setThinking(false)
        setPending(null)
        setRunId(null)
        runRef.current = null
        setLog((prev) => [...prev, { type: 'end', status: event.status, text: event.text }])
        void ctx.refresh()
      }
    })
  }, [bridge, ctx])

  async function start() {
    setError(null)
    const text = goal.trim()
    try {
      const { runId: id } = await bridge.startAgent({ goal: text })
      runRef.current = id
      setRunId(id)
      setLog((prev) => [...prev, { type: 'goal', text }])
      setGoal('')
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function answer(approve: boolean) {
    if (!pending || !runId) return
    const { callId } = pending
    setPending(null)
    try {
      await bridge.answerAgent({ runId, callId, approve })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const running = runId !== null
  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <article className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Agente local</h2>
          <div className="row">
            {agent?.local ? <Badge tone="ready">Ollama en localhost</Badge> : <Badge tone="bad">El endpoint no es local</Badge>}
            <span className="path muted">{agent?.model || 'sin modelo'}</span>
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          {view.autonomous
            ? 'Modo autónomo: escribe archivos y ejecuta comandos permitidos sin preguntar. Instalar paquetes sí pregunta.'
            : 'Te pedirá permiso antes de cada cambio y de cada comando.'}{' '}
          Cada cambio aceptado queda como un commit y se puede deshacer en «Historial».
        </p>
        <div className="agent-log" aria-live="polite">
          {log.length === 0 ? <p className="small muted">Pide un objetivo pequeño y concreto, p. ej. «añade la función X y su prueba».</p> : null}
          {log.map((item, index) => {
            if (item.type === 'goal') return <div key={index} className="msg user">{item.text}</div>
            if (item.type === 'message') return <div key={index} className="msg ai">{item.text}</div>
            if (item.type === 'end')
              return (
                <div key={index} className={`msg end ${item.status}`}>
                  <strong>{END_LABEL[item.status] ?? item.status}.</strong> {item.text}
                </div>
              )
            return (
              <details key={index} className={`tool-line ${item.status}`}>
                <summary>
                  <span className="dot" /> <span className="path">{item.summary}</span> <span className="muted">· {STATUS_LABEL[item.status]}</span>
                </summary>
                {item.detail ? (item.tool === 'escribir' || item.tool === 'editar' ? <DiffView text={item.detail} /> : <OutputView text={item.detail} />) : null}
              </details>
            )
          })}
          {thinking ? <p className="small muted">El modelo está pensando…</p> : null}
        </div>
        {pending?.request.type === 'write' ? (
          <div className="proposal" role="region" aria-label="Cambio propuesto">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong className="small">
                {pending.request.created ? 'Archivo nuevo' : 'Cambio propuesto'} · <span className="path">{pending.request.path}</span>
              </strong>
              <span className="small muted">
                +{pending.request.added} −{pending.request.removed}
              </span>
            </div>
            <div style={{ marginTop: 6 }}>
              <DiffView text={pending.request.diff} />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <Button type="button" onClick={() => void answer(true)}>Aceptar cambio</Button>
              <Button type="button" variant="secondary" onClick={() => void answer(false)}>Rechazar</Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="banner" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'nowrap' }}>
          <div style={{ flex: 1 }}>
            <Area aria-label="Objetivo para el agente" placeholder="¿Qué quieres que haga?" value={goal} disabled={running} onChange={(event) => setGoal(event.target.value)} style={{ minHeight: 64 }} />
          </div>
          {running ? (
            <Button type="button" variant="danger" onClick={() => runId && void bridge.cancelAgent(runId)}>Detener</Button>
          ) : (
            <Button type="button" disabled={!goal.trim() || !agent?.local || !agent.model} onClick={() => void start()}>Empezar</Button>
          )}
        </div>
      </article>
      {pending?.request.type === 'command' ? (
        <CommandConfirm check={pending.request.check} root={project.root} origin="modelo" autonomous={view.autonomous} onAnswer={(ok) => void answer(ok)} />
      ) : null}
    </div>
  )
}
