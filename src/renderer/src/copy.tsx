import { useEffect, useState } from 'react'
import type { AppState, CopyRunState, CopyStepId, ProgramDetection, ReaBridge } from '../../shared/types'
import { isLocalEndpoint } from '../../core/ollama'
import { defaultProjectsDir } from '../../core/copy/names'
import { Button, Field, Label } from './ui'

const STEP_META: Array<{ id: CopyStepId; label: string; hint: string }> = [
  { id: 'analizando', label: 'Analizando', hint: 'Estudia el original en modo Deep (Craft Anything, con nuestro Ghidra). Si falla, se usan nuestras herramientas.' },
  { id: 'creando', label: 'Creando proyecto', hint: 'Prepara la carpeta, la plantilla y la ficha del análisis.' },
  { id: 'copiando', label: 'Copiando', hint: 'Reproduce con fidelidad el comportamiento del original.' },
  { id: 'comprobando', label: 'Comprobando', hint: 'Compara la copia con el original, muestra el parecido y lo que no coincide.' },
  { id: 'mejorando', label: 'Mejorando', hint: 'Añade mejoras, cada una por separado y con su motivo.' },
  { id: 'listo', label: 'Listo', hint: 'La copia queda lista para abrir o ejecutar.' },
]

function hasLocalModel(state: AppState): boolean {
  return Boolean(state.settings.providers.compatible.model.trim()) && isLocalEndpoint(state.settings.providers.compatible.endpoint)
}

export function CopyScreen({
  bridge,
  state,
  onOpenSettings,
}: {
  bridge: ReaBridge
  state: AppState
  onOpenSettings: () => void
}) {
  const [source, setSource] = useState<ProgramDetection | null>(null)
  const [destParent, setDestParent] = useState<string>(() => defaultProjectsDir())
  const [destOverride, setDestOverride] = useState<string | null>(null)
  const [run, setRun] = useState<CopyRunState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const readyModel = hasLocalModel(state)

  useEffect(() => {
    void bridge.copyState().then((current) => {
      if (current) setRun(current)
    })
    return bridge.onCopyEvent(setRun)
  }, [bridge])

  const dest = destOverride ?? source?.suggestedDest ?? destParent
  const busy = run?.status === 'running' || run?.status === 'needs-package' || run?.status === 'needs-run-original'
  const showProgress = run && run.status !== 'idle'

  async function pick(kind: 'file' | 'folder') {
    setError(null)
    const path = kind === 'file' ? await bridge.chooseFile() : await bridge.chooseFolder()
    if (!path) return
    try {
      const detection = await bridge.detectProgram(path, destParent)
      setSource(detection)
      setDestOverride(null)
      setRun(null)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  async function pickDest() {
    const dir = await bridge.chooseDestDir()
    if (!dir) return
    setDestParent(dir)
    if (source) {
      const detection = await bridge.detectProgram(source.sourcePath, dir)
      setSource(detection)
      setDestOverride(detection.suggestedDest)
    }
  }

  async function start() {
    if (!source) return
    setError(null)
    setDetailsOpen(false)
    try {
      const next = await bridge.startCopy({ sourcePath: source.sourcePath, destParent })
      setRun(next)
    } catch (reason) {
      setError((reason as Error).message)
    }
  }

  const modelGate = !readyModel

  if (showProgress && run && run.status !== 'idle') {
    return (
      <ProgressView
        run={run}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((open) => !open)}
        onCancel={() => void bridge.cancelCopy()}
        onRetry={() => void bridge.retryCopy()}
        onOpenFolder={() => void bridge.openCopyFolder()}
        onRun={async () => {
          const result = await bridge.runCopy()
          setRunMessage(result.ok ? 'La aplicación se ha lanzado.' : result.error ?? 'No he podido ejecutarla.')
        }}
        onReset={() => {
          setRun(null)
          setRunMessage(null)
        }}
        runMessage={runMessage}
        onAnswer={(approve) => void bridge.answerCopyPackage(approve)}
        onAnswerRunOriginal={(approve) => void bridge.answerCopyRunOriginal(approve)}
      />
    )
  }

  return (
    <div className="page">
      <h1>Copiar aplicación</h1>
      <p className="lead">Elige el programa original y pulsa Copiar. REA Studio se encarga del análisis, crea el proyecto y lo mejora por ti.</p>
      {modelGate ? (
        <p className="banner" style={{ marginTop: 18 }}>
          Hace falta un modelo local para copiar la aplicación.{' '}
          <Button type="button" variant="ghost" onClick={onOpenSettings}>
            Elige o descarga un modelo
          </Button>
        </p>
      ) : null}
      {error ? <p className="banner" style={{ marginTop: 18 }}>{error}</p> : null}
      <div className="stack">
        <article className="card">
          <h2>Programa original</h2>
          {source ? (
            <div className="drop ready" style={{ marginTop: 14 }}>
              <div>
                <div className="app-name">{source.name}</div>
                <div className="path" style={{ marginTop: 4 }}>{source.sourcePath}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className={`pill ${source.kind === 'unknown' ? 'bad' : 'ready'}`}>
                    {source.kind === 'unknown' ? source.kindLabel : `Detectado: ${source.kindLabel}`}
                  </span>
                  {source.templateLabel ? <span className="pill">Plantilla: {source.templateLabel}</span> : null}
                </div>
                {source.reason ? <p className="small muted hint">{source.reason}</p> : null}
                {source.note ? <p className="small muted hint">{source.note}</p> : null}
                {source.modules && source.modules.length > 0 ? (
                  <p className="small muted hint">Se analizarán {source.modules.length} módulo(s) aparte, uno cada vez.</p>
                ) : null}
              </div>
              <Button type="button" variant="secondary" onClick={() => setSource(null)}>
                Cambiar…
              </Button>
            </div>
          ) : (
            <div className="drop" style={{ marginTop: 14 }}>
              <div>
                <div className="css-empty">Ninguno seleccionado</div>
                <p className="small muted hint">Un ejecutable o una carpeta: Electron, .NET, Java/APK, Python o nativo (C/C++).</p>
              </div>
              <div className="row">
                <Button type="button" variant="secondary" onClick={() => void pick('file')}>
                  Elegir archivo…
                </Button>
                <Button type="button" variant="secondary" onClick={() => void pick('folder')}>
                  Elegir carpeta…
                </Button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <Label>Se guardará en</Label>
            <div className="row">
              <Field readOnly value={dest} style={{ flex: 1 }} />
              <Button type="button" variant="secondary" onClick={() => void pickDest()}>
                Elegir…
              </Button>
            </div>
            <p className="small muted hint">
              {source
                ? 'Si la carpeta no existe, se creará. No hace falta elegir plantilla ni lanzar el análisis a mano.'
                : 'La carpeta final usará el nombre del programa. La plantilla y el lenguaje se eligen solos.'}
            </p>
          </div>
          <div className="row" style={{ marginTop: 18 }}>
            <Button type="button" className="big" disabled={!source || source.kind === 'unknown' || modelGate || busy} onClick={() => void start()}>
              Copiar
            </Button>
          </div>
        </article>
      </div>
    </div>
  )
}

function ProgressView({
  run,
  detailsOpen,
  onToggleDetails,
  onCancel,
  onRetry,
  onOpenFolder,
  onRun,
  onReset,
  runMessage,
  onAnswer,
  onAnswerRunOriginal,
}: {
  run: CopyRunState
  detailsOpen: boolean
  onToggleDetails: () => void
  onCancel: () => void
  onRetry: () => void
  onOpenFolder: () => void
  onRun: () => void
  onReset: () => void
  runMessage: string | null
  onAnswer: (approve: boolean) => void
  onAnswerRunOriginal: (approve: boolean) => void
}) {
  const titles: Record<CopyStepId, string> = {
    analizando: `Copiando ${run.detection.name}`,
    creando: `Copiando ${run.detection.name}`,
    copiando: `Copiando ${run.detection.name}`,
    comprobando: `Copiando ${run.detection.name}`,
    mejorando: `Copiando ${run.detection.name}`,
    listo: 'Listo',
  }
  const leads: Record<CopyStepId, string> = {
    analizando: 'Analizando el original. Después se creará el proyecto y se copiará la aplicación.',
    creando: 'Creando la carpeta del proyecto y la ficha del análisis.',
    copiando: 'Reproduciendo el original con fidelidad. Después se comprobará la copia y, si hace falta, se corregirá.',
    comprobando: 'Comparando la copia con el original. Verás el porcentaje de parecido y lo que aún no coincide.',
    mejorando: 'El original ya está copiado y comprobado. Ahora se están añadiendo las mejoras.',
    listo: `${run.detection.name} ya está copiado y mejorado en su carpeta de proyecto.`,
  }
  const failed = run.status === 'failed'
  const cancelled = run.status === 'cancelled'
  const done = run.status === 'done'
  const stepIndex = STEP_META.findIndex((item) => item.id === run.step)
  const stepLabel = STEP_META[stepIndex]?.label ?? run.step

  return (
    <div className="page">
      <h1>{failed || cancelled ? `Copiando ${run.detection.name}` : titles[run.step]}</h1>
      <p className="lead">
        {failed || cancelled
          ? 'Se ha parado el proceso. Puedes reintentarlo o cancelar y elegir otro programa.'
          : leads[run.step]}
      </p>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${run.progress}%` }} />
      </div>
      <p className="small muted">
        Paso {Math.min(stepIndex + 1, 6)} de 6 · {stepLabel}
        {run.check ? ` · Comprobación ${run.check.round} de ${run.check.maxRounds}` : ''}
        {run.check?.alike != null ? ` · ${Math.round(run.check.alike)} % de parecido` : ''}
      </p>
      <div className="steps">
        {STEP_META.map((item, index) => {
          let klass = 'todo'
          let mark: string = String(index + 1)
          let extra = null
          const isCurrent = item.id === run.step
          if (done || index < stepIndex) {
            klass = 'done'
            mark = '✓'
            extra = <span className="pill ready">Hecho</span>
          } else if (isCurrent && failed) {
            klass = 'fail'
            mark = '!'
            extra = <span className="pill bad">Error</span>
          } else if (isCurrent && !cancelled) {
            klass = 'now'
            extra = <span className="pill">En curso</span>
          }
          const showHint = (isCurrent && (klass === 'now' || klass === 'fail')) || (done && item.id === 'listo')
          return (
            <div key={item.id} className={`step-row ${klass}`}>
              <span className="badge-n">{mark}</span>
              <div>
                <div>{item.label}</div>
                {showHint ? <div className="small muted">{item.hint}</div> : null}
              </div>
              {extra}
            </div>
          )
        })}
      </div>
      {failed ? <div className="banner" style={{ marginTop: 18 }}>{run.error}</div> : null}
      {cancelled ? <div className="banner" style={{ marginTop: 18 }}>{run.error ?? 'Se ha cancelado la copia.'}</div> : null}
      {runMessage ? <p className="small muted" style={{ marginTop: 14 }}>{runMessage}</p> : null}
      {done && run.summary ? (
        <div className="summary-box">
          {run.summary.alike != null ? (
            <article className="card">
              <h2>Parecido</h2>
              <p className="small">{Math.round(run.summary.alike)} % de parecido con el original.</p>
            </article>
          ) : null}
          <article className="card">
            <h2>Se copió del original</h2>
            <p className="small">{run.summary.copied}</p>
          </article>
          <article className="card">
            <h2>Se mejoró</h2>
            <p className="small">{run.summary.improved}</p>
          </article>
          <article className="card">
            <h2>Pendiente</h2>
            <p className="small">{run.summary.pending}</p>
          </article>
        </div>
      ) : null}
      <div className="row" style={{ marginTop: done ? 20 : 18 }}>
        {done ? (
          <>
            <Button type="button" className="big" onClick={onOpenFolder}>
              Abrir carpeta
            </Button>
            <Button type="button" className="big" variant="secondary" onClick={onRun}>
              Ejecutar
            </Button>
            <Button type="button" variant="ghost" onClick={onReset}>
              Hacer otra copia
            </Button>
          </>
        ) : failed || cancelled ? (
          <>
            <Button type="button" onClick={onRetry}>
              Reintentar
            </Button>
            <Button type="button" variant="ghost" onClick={onReset}>
              Cancelar
            </Button>
          </>
        ) : (
          <Button type="button" variant="danger" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
      <details className="copy-details" open={detailsOpen} onToggle={(event) => {
        const open = (event.currentTarget as HTMLDetailsElement).open
        if (open !== detailsOpen) onToggleDetails()
      }}>
        <summary>
          Ver detalles <span className="chev">{detailsOpen ? 'Ocultar' : 'Mostrar'}</span>
        </summary>
        {detailsOpen ? <pre className="log">{run.details.join('\n') || 'Todavía no hay detalles.'}</pre> : null}
      </details>
      {run.status === 'needs-package' && run.packageRequest ? (
        <PackageDialog request={run.packageRequest} dest={run.destPath} onAnswer={onAnswer} />
      ) : null}
      {run.status === 'needs-run-original' ? (
        <RunOriginalDialog dest={run.sourcePath} onAnswer={onAnswerRunOriginal} />
      ) : null}
    </div>
  )
}

function RunOriginalDialog({ dest, onAnswer }: { dest: string; onAnswer: (approve: boolean) => void }) {
  return (
    <>
      <div className="overlay" />
      <div className="modal confirm" role="dialog" aria-labelledby="copy-run-title">
        <h2 id="copy-run-title" style={{ margin: 0, fontSize: 20, letterSpacing: '-0.03em' }}>
          ¿Ejecutar el original?
        </h2>
        <p className="small" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
          Para comparar un poco más la copia con el original haría falta ejecutarlo. El original no se lanza si no lo confirmas. Si dices que no, se sigue con una comparación sin ejecutarlo.
        </p>
        <div className="kv">
          <div className="muted">Original</div>
          <div className="path">{dest}</div>
        </div>
        <div className="row" style={{ marginTop: 22, justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={() => onAnswer(false)}>
            Ahora no
          </Button>
          <Button type="button" onClick={() => onAnswer(true)}>
            Ejecutar original
          </Button>
        </div>
      </div>
    </>
  )
}

function PackageDialog({
  request,
  dest,
  onAnswer,
}: {
  request: NonNullable<CopyRunState['packageRequest']>
  dest: string
  onAnswer: (approve: boolean) => void
}) {
  return (
    <>
      <div className="overlay" />
      <div className="modal confirm" role="dialog" aria-labelledby="copy-pkg-title">
        <h2 id="copy-pkg-title" style={{ margin: 0, fontSize: 20, letterSpacing: '-0.03em' }}>
          ¿Instalar este paquete?
        </h2>
        <p className="small" style={{ margin: '10px 0 0', lineHeight: 1.5 }}>
          Hay que instalar un paquete para continuar con una mejora. Se descargará de internet y quedará solo en la carpeta del proyecto.
        </p>
        <div className="kv">
          <div className="muted">Comando</div>
          <div className="path">{request.display || `${request.command} ${request.args.join(' ')}`}</div>
          <div className="muted">Carpeta</div>
          <div className="path">{dest}</div>
        </div>
        <div className="row" style={{ marginTop: 22, justifyContent: 'flex-end' }}>
          <Button type="button" variant="secondary" onClick={() => onAnswer(false)}>
            Ahora no
          </Button>
          <Button type="button" onClick={() => onAnswer(true)}>
            Instalar
          </Button>
        </div>
      </div>
    </>
  )
}
