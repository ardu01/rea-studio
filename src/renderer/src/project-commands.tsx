import { useEffect, useRef, useState } from 'react'
import type { CommandCheck, CommandResult, ProjectEvent } from '../../shared/types'
import type { ProjectContext } from './project'
import { Badge, Button, Field } from './ui'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción.'
}

export function OutputView({ text }: { text: string }) {
  if (!text) return <p className="small muted">Sin salida todavía.</p>
  return (
    <pre className="code" aria-label="Salida del comando">
      {text.split('\n').map((line, index) => (
        <span key={index} className={/\b(error|errores|fail(ed)?|falló)\b|✗|×|AssertionError|Traceback/i.test(line) ? 'err' : /\b(passed|ok|correcto)\b|✓/i.test(line) ? 'ok' : ''}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

export function statusBadge(result: CommandResult | null, running: boolean) {
  if (running) return <Badge tone="warn">En marcha…</Badge>
  if (!result) return null
  if (result.status === 'succeeded') return <Badge tone="ready">Correcto · código 0</Badge>
  if (result.status === 'cancelled') return <Badge>Detenido</Badge>
  if (result.status === 'timed-out') return <Badge tone="bad">Tiempo agotado</Badge>
  return <Badge tone="bad">Falló · código {result.exitCode ?? '—'}</Badge>
}

/** Diálogo de confirmación de un comando. Lo usan los comandos manuales y el agente. */
export function CommandConfirm({
  check,
  root,
  origin,
  autonomous,
  onAnswer,
}: {
  check: CommandCheck
  root: string
  origin: 'usuario' | 'modelo'
  autonomous: boolean
  onAnswer: (ok: boolean) => void
}) {
  return (
    <div className="overlay" role="presentation">
      <div className="modal confirm" role="dialog" aria-modal="true" aria-label="¿Ejecutar este comando?">
        <h2>¿Ejecutar este comando?</h2>
        <p className="small muted">
          {origin === 'modelo' ? 'Lo ha pedido el modelo. ' : ''}
          {check.kind === 'install'
            ? 'Instala paquetes: siempre se pregunta, también en modo autónomo.'
            : autonomous
              ? 'Está en la lista permitida.'
              : 'Está en la lista permitida. Con el modo autónomo activado se ejecutaría sin preguntar.'}
        </p>
        <pre className="code" style={{ marginTop: 12 }}>{check.display}</pre>
        <div className="kv">
          <span className="muted">Carpeta</span>
          <span className="path">{root}</span>
          <span className="muted">Red</span>
          <span>{check.network ? 'Sí: descarga del registro público de paquetes' : 'No debería necesitarla (no hay garantía técnica)'}</span>
          <span className="muted">Shell</span>
          <span>No: se lanza el ejecutable directamente</span>
        </div>
        <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={() => onAnswer(false)}>Rechazar</Button>
          <Button type="button" onClick={() => onAnswer(true)}>Ejecutar</Button>
        </div>
      </div>
    </div>
  )
}

export function CommandsPanel({ ctx }: { ctx: ProjectContext }) {
  const { bridge, view } = ctx
  const project = view.project!
  const [line, setLine] = useState('')
  const [pending, setPending] = useState<CommandCheck | null>(null)
  const [runId, setRunId] = useState<string | null>(null)
  const [output, setOutput] = useState('')
  const [result, setResult] = useState<CommandResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const runRef = useRef<string | null>(null)

  useEffect(() => {
    return bridge.onProjectEvent((event: ProjectEvent) => {
      if (event.runId !== runRef.current) return
      if (event.kind === 'chunk') {
        setOutput((prev) => (prev + event.text).slice(-60_000))
        return
      }
      runRef.current = null
      setRunId(null)
      if (event.result) {
        setResult(event.result)
        setOutput(event.result.output)
      }
      if (event.error) setError(event.error)
      void ctx.refresh()
    })
  }, [bridge, ctx])

  async function start(command: string, args: string[], confirmed: boolean) {
    setError(null)
    setResult(null)
    setOutput('')
    try {
      const { runId: id } = await bridge.runCommand({ command, args, confirmed })
      runRef.current = id
      setRunId(id)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function request(command: string, args: string[]) {
    setError(null)
    try {
      const check = await bridge.checkCommand(command, args)
      if (!check.allowed) {
        setError(check.reason ?? 'Comando no permitido.')
        return
      }
      if (check.needsApproval) setPending(check)
      else await start(command, args, false)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function requestLine() {
    try {
      const { command, args } = splitLine(line)
      await request(command, args)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const running = runId !== null
  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <article className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Comandos del proyecto</h2>
          {statusBadge(result, running)}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          {project.commands.map((item) => (
            <Button key={item.label + item.args.join(' ')} type="button" variant="secondary" disabled={running} onClick={() => void request(item.command, item.args)}>
              {item.label}: {item.command} {item.args.join(' ')}
            </Button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12, flexWrap: 'nowrap' }}>
          <Field aria-label="Otro comando" placeholder="Otro comando permitido, p. ej. npm run lint" value={line} disabled={running} onChange={(event) => setLine(event.target.value)} />
          <Button type="button" disabled={running || !line.trim()} onClick={() => void requestLine()}>Ejecutar</Button>
          {running ? (
            <Button type="button" variant="danger" onClick={() => runId && void bridge.cancelCommand(runId)}>Detener</Button>
          ) : null}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          Sin shell: no valen &amp;&amp;, |, &gt; ni ;. Permitidos: npm, node, python, pytest, pip, dotnet, cmake, ctest, ninja, make, cargo, go y git (status, diff, log).
        </p>
        {error ? <p className="banner" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      </article>
      <article className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Salida</h2>
          {result ? <span className="small muted">{(result.durationMs / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s · registro en <span className="path">{result.logPath}</span></span> : null}
        </div>
        <div style={{ marginTop: 10 }}>
          <OutputView text={output} />
        </div>
      </article>
      {pending ? (
        <CommandConfirm
          check={pending}
          root={project.root}
          origin="usuario"
          autonomous={view.autonomous}
          onAnswer={(ok) => {
            const check = pending
            setPending(null)
            if (ok) void start(check.command, check.args, true)
          }}
        />
      ) : null}
    </div>
  )
}

/** Copia en el renderer de splitCommandLine (sin importar código de node). */
export function splitLine(text: string): { command: string; args: string[] } {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const ch of text.trim()) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += ch
    started = true
  }
  if (quote) throw new Error('Falta cerrar una comilla.')
  if (started) tokens.push(current)
  const [command, ...args] = tokens
  if (!command) throw new Error('Escribe un comando.')
  return { command, args }
}
