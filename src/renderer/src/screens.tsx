import { useEffect, useState } from 'react'
import type { AppState, ArtifactEntry, ChatLine, Detection, DisclosureView, JobRecord, ProviderCheck, ReaBridge } from '../../shared/types'
import { Area, Badge, Button, CheckRow, ConfirmDialog, Field, Label } from './ui'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción.'
}

export function Onboarding({
  bridge,
  state,
  onState,
}: {
  bridge: ReaBridge
  state: AppState
  onState: (state: AppState) => void
}) {
  const [step, setStep] = useState(0)
  const [accepted, setAccepted] = useState(false)
  const [folder, setFolder] = useState(state.settings.workspacePath ?? '')
  const [detections, setDetections] = useState<Detection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose() {
    setError(null)
    const next = await bridge.chooseWorkspace()
    if (!next?.settings.workspacePath) return
    setFolder(next.settings.workspacePath)
    onState(next)
  }

  async function detect() {
    setBusy(true)
    setError(null)
    try {
      setDetections(await bridge.detectTools())
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setBusy(true)
    setError(null)
    try {
      onState(await bridge.acceptNotice(folder))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="center">
      <div className="onboard">
        <p className="muted small">REA Studio</p>
        {step === 0 ? (
          <>
            <h1>Un escritorio para el análisis que ya puedes hacer en local.</h1>
            <p className="lead">
              Reúne REA, Ghidra headless y otras herramientas instaladas en este equipo. Los modelos se usan aparte, y solo si confirmas qué texto sale de la máquina.
            </p>
            <div className="card" style={{ marginTop: 28 }}>
              <h2>Uso autorizado</h2>
              <p className="small muted" style={{ marginTop: 8 }}>
                Abre solo binarios y código que tengas autorización para estudiar. El análisis previsto es local y estático: REA Studio no ejecuta el archivo examinado, no pide privilegios de administrador y no desactiva protecciones.
              </p>
              <div style={{ marginTop: 16 }}>
                <CheckRow checked={accepted} onCheckedChange={setAccepted}>
                  He leído el aviso y tengo autorización para los archivos que voy a abrir.
                </CheckRow>
              </div>
            </div>
            <div className="row" style={{ marginTop: 22 }}>
              <Button type="button" disabled={!accepted} onClick={() => setStep(1)}>
                Continuar
              </Button>
            </div>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <h1>Carpeta de trabajo</h1>
            <p className="lead">Los registros y resúmenes se quedan en esa carpeta. Las claves de API no se escriben ahí.</p>
            <div className="card" style={{ marginTop: 28 }}>
              <p className="path">{folder || 'Todavía no hay carpeta.'}</p>
              <div className="row" style={{ marginTop: 14 }}>
                <Button type="button" variant="secondary" onClick={() => void choose()}>
                  Elegir carpeta
                </Button>
                <Button type="button" disabled={!folder} onClick={() => setStep(2)}>
                  Continuar
                </Button>
              </div>
            </div>
          </>
        ) : null}
        {step === 2 ? (
          <>
            <h1>Herramientas de este equipo</h1>
            <p className="lead">
              La aplicación puede estar instalada y las herramientas no. Puedes entrar igual y configurarlas después.
            </p>
            <div className="row" style={{ marginTop: 22 }}>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => void detect()}>
                {busy ? 'Comprobando…' : 'Comprobar este equipo'}
              </Button>
            </div>
            <div className="stack">
              {detections?.map((item) => (
                <article key={item.id} className="card">
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <h2>{item.name}</h2>
                    <Badge tone={toneOf(item)}>{labelOf(item)}</Badge>
                  </div>
                  <p className="small muted">{item.detail}</p>
                </article>
              ))}
            </div>
            {error ? <p className="banner" style={{ marginTop: 16 }}>{error}</p> : null}
            <div className="row" style={{ marginTop: 22 }}>
              <Button type="button" disabled={busy || !folder} onClick={() => void finish()}>
                Entrar al estudio
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

export function HomeScreen({
  bridge,
  state,
  onState,
  onOpen,
}: {
  bridge: ReaBridge
  state: AppState
  onState: (state: AppState) => void
  onOpen: (route: 'trabajos' | 'herramientas' | 'conversacion') => void
}) {
  const [jobs, setJobs] = useState<JobRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const readyKeys = state.providers.filter((item) => item.configured).length

  useEffect(() => {
    bridge.listJobs().then(setJobs).catch((reason: Error) => setError(reason.message))
  }, [bridge])

  async function changeFolder() {
    const next = await bridge.chooseWorkspace()
    if (next) onState(next)
  }

  return (
    <div className="page">
      <h1>{workspaceName(state)}</h1>
      <p className="lead">Los análisis de esta carpeta se quedan en el equipo hasta que adjuntes una salida a un proveedor.</p>
      <p className="path" style={{ marginTop: 10 }}>{state.settings.workspacePath}</p>
      <div className="grid">
        <article className="card">
          <h2>Trabajos</h2>
          <p className="lead" style={{ fontSize: 28, marginTop: 10 }}>{jobs ? jobs.length : '…'}</p>
          <Button type="button" variant="ghost" onClick={() => onOpen('trabajos')}>Ver trabajos</Button>
        </article>
        <article className="card">
          <h2>Proveedores con dato local</h2>
          <p className="lead" style={{ fontSize: 28, marginTop: 10 }}>{readyKeys}</p>
          <p className="small muted">Clave guardada o CLI presente. Eso no significa que la conexión esté comprobada.</p>
        </article>
        <article className="card">
          <h2>Carpeta</h2>
          <p className="small muted" style={{ marginTop: 10 }}>Cambia de espacio cuando quieras examinar otro conjunto de archivos.</p>
          <div style={{ marginTop: 12 }}>
            <Button type="button" variant="secondary" onClick={() => void changeFolder()}>Cambiar carpeta</Button>
          </div>
        </article>
      </div>
      <div className="stack">
        <h2 style={{ margin: '8px 0 0', fontSize: 18 }}>Últimos trabajos</h2>
        {error ? <p className="banner">{error}</p> : null}
        {jobs && jobs.length === 0 ? (
          <div className="card">
            <h3>Todavía no hay análisis</h3>
            <p className="small muted">Elige una herramienta y un archivo. Las cadenas y los metadatos funcionan sin instalar nada más.</p>
            <div style={{ marginTop: 12 }}>
              <Button type="button" onClick={() => onOpen('trabajos')}>Empezar un trabajo</Button>
            </div>
          </div>
        ) : null}
        {jobs?.slice(0, 5).map((job) => (
          <article key={job.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{job.title}</h3>
              <Badge tone={jobTone(job.status)}>{statusLabel(job.status)}</Badge>
            </div>
            <p className="path">{job.targetPath || 'Sin archivo de entrada'}</p>
          </article>
        ))}
        <Button type="button" variant="secondary" onClick={() => onOpen('herramientas')}>Comprobar herramientas</Button>
      </div>
    </div>
  )
}

export function ToolsScreen({
  bridge,
  state,
  onState,
  detections,
  onDetections,
}: {
  bridge: ReaBridge
  state: AppState
  onState: (state: AppState) => void
  detections: Detection[] | null
  onDetections: (items: Detection[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [paths, setPaths] = useState(state.settings.tools)

  async function detect() {
    setBusy(true)
    setError(null)
    try {
      onDetections(await bridge.detectTools())
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function save(id: keyof AppState['settings']['tools']) {
    setError(null)
    try {
      onState(await bridge.updateSettings({ tools: { [id]: paths[id] } }))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page">
      <h1>Herramientas</h1>
      <p className="lead">
        REA Studio no incluye Ghidra, REA, radare2 ni Rizin. Indica la ruta o déjalas en PATH. Los complementos futuros se detectan, pero no se ejecutan.
      </p>
      <div className="row" style={{ marginTop: 22 }}>
        <Button type="button" disabled={busy} onClick={() => void detect()}>
          {busy ? 'Comprobando…' : detections ? 'Volver a comprobar' : 'Comprobar este equipo'}
        </Button>
      </div>
      {!detections ? <p className="muted" style={{ marginTop: 18 }}>Sin comprobar en esta sesión.</p> : null}
      {error ? <p className="banner" style={{ marginTop: 16 }}>{error}</p> : null}
      <div className="stack">
        {detections?.map((item) => (
          <article key={item.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{item.name}</h2>
              <Badge tone={toneOf(item)}>{labelOf(item)}</Badge>
            </div>
            <p className="small" style={{ marginTop: 8 }}>{item.detail}</p>
            <p className="small muted">{item.installHint}</p>
            <p className="small muted">{item.verification}</p>
            {pathKey(item.id) ? (
              <PathEditor
                label="Ruta"
                name={item.name}
                value={paths[pathKey(item.id)!] ?? ''}
                onChange={(value) => setPaths({ ...paths, [pathKey(item.id)!]: value })}
                onSave={() => void save(pathKey(item.id)!)}
              />
            ) : null}
            {item.id === 'ghidra' ? (
              <PathEditor
                label="Ruta de java"
                name="Java"
                value={paths.java}
                onChange={(value) => setPaths({ ...paths, java: value })}
                onSave={() => void save('java')}
              />
            ) : null}
            {item.id === 'radare2' ? (
              <PathEditor
                label="Ruta de rabin2"
                name="rabin2"
                value={paths.rabin2}
                onChange={(value) => setPaths({ ...paths, rabin2: value })}
                onSave={() => void save('rabin2')}
              />
            ) : null}
            {item.id === 'rizin' ? (
              <PathEditor
                label="Ruta de rz-bin"
                name="rz-bin"
                value={paths.rzBin}
                onChange={(value) => setPaths({ ...paths, rzBin: value })}
                onSave={() => void save('rzBin')}
              />
            ) : null}
            <div style={{ marginTop: 10 }}>
              <Button type="button" variant="ghost" onClick={() => void bridge.openDocs(item.docsUrl)}>
                Documentación
              </Button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}

export function JobsScreen({ bridge }: { bridge: ReaBridge }) {
  const [detections, setDetections] = useState<Detection[]>([])
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [selected, setSelected] = useState<string>('')
  const [adapterId, setAdapterId] = useState('strings')
  const [actionId, setActionId] = useState('extract')
  const [target, setTarget] = useState('')
  const [timeoutSec, setTimeoutSec] = useState(120)
  const [log, setLog] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const usable = detections.filter((item) => item.maturity !== 'future' && item.actions.length > 0)
  const current = usable.find((item) => item.id === adapterId) ?? usable[0]
  const action = current?.actions.find((item) => item.id === actionId) ?? current?.actions[0]

  useEffect(() => {
    void bridge.detectTools().then((items) => {
      setDetections(items)
      const first = items.find((item) => item.id === 'strings') ?? items.find((item) => item.actions.length)
      if (first) {
        setAdapterId(first.id)
        setActionId(first.actions[0]?.id ?? '')
      }
    })
    void bridge.listJobs().then((items) => {
      setJobs(items)
      if (items[0]) {
        setSelected(items[0].id)
        void bridge.readLog(items[0].id).then(setLog)
      }
    })
    return bridge.onJobEvent((event) => {
      if (event.kind === 'log') {
        setSelected((currentId) => {
          if (currentId === event.jobId) setLog((prev) => prev + event.text)
          return currentId
        })
      }
      if (event.kind === 'status') {
        setJobs((prev) => [event.job, ...prev.filter((item) => item.id !== event.job.id)])
        if (event.job.status !== 'running') setBusy(false)
      }
    })
  }, [bridge])

  async function chooseFile() {
    const file = await bridge.chooseFile()
    if (file) setTarget(file)
  }

  async function start() {
    if (!current || !action) return
    setError(null)
    setBusy(true)
    setLog('')
    try {
      const job = await bridge.startJob({
        adapterId: current.id,
        actionId: action.id,
        targetPath: action.needsTarget ? target : undefined,
        timeoutSec,
      })
      setSelected(job.id)
      setJobs((prev) => [job, ...prev.filter((item) => item.id !== job.id)])
    } catch (reason) {
      setBusy(false)
      setError(messageOf(reason))
    }
  }

  async function cancel() {
    if (!selected) return
    try {
      const job = await bridge.cancelJob(selected)
      setJobs((prev) => prev.map((item) => (item.id === job.id ? job : item)))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const active = jobs.find((item) => item.id === selected)

  return (
    <div className="page">
      <h1>Trabajos</h1>
      <p className="lead">Cada acción lanza el comando documentado de la herramienta, o el lector local de cadenas y metadatos. El archivo no se ejecuta.</p>
      <div className="card" style={{ marginTop: 22 }}>
        <div className="grid" style={{ marginTop: 0 }}>
          <div>
            <Label>Herramienta</Label>
            <select className="select" aria-label="Herramienta" value={current?.id ?? ''} onChange={(event) => {
              const next = usable.find((item) => item.id === event.target.value)
              setAdapterId(event.target.value)
              setActionId(next?.actions[0]?.id ?? '')
            }}>
              {usable.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Acción</Label>
            <select className="select" aria-label="Acción" value={action?.id ?? ''} onChange={(event) => setActionId(event.target.value)}>
              {current?.actions.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Tiempo límite (segundos)</Label>
            <Field aria-label="Tiempo límite" type="number" min={1} max={3600} value={timeoutSec} onChange={(event) => setTimeoutSec(Number(event.target.value))} />
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>{action?.summary}</p>
        {action?.needsTarget ? (
          <div className="row" style={{ marginTop: 12 }}>
            <Field aria-label="Archivo objetivo" value={target} placeholder="Ruta absoluta" onChange={(event) => setTarget(event.target.value)} />
            <Button type="button" variant="secondary" onClick={() => void chooseFile()}>Elegir archivo</Button>
          </div>
        ) : null}
        <div className="row" style={{ marginTop: 14 }}>
          <Button type="button" disabled={busy} onClick={() => void start()}>{busy ? 'En curso…' : 'Iniciar'}</Button>
          <Button type="button" variant="secondary" disabled={!active || active.status !== 'running'} onClick={() => void cancel()}>Cancelar</Button>
        </div>
        {error ? <p className="banner" style={{ marginTop: 12 }}>{error}</p> : null}
      </div>
      <div className="split">
        <div>
          {jobs.length === 0 ? <p className="muted small">Sin trabajos en esta carpeta.</p> : null}
          {jobs.map((job) => (
            <button key={job.id} type="button" className="list-btn" aria-current={job.id === selected} onClick={() => {
              setSelected(job.id)
              void bridge.readLog(job.id).then(setLog)
            }}>
              <strong>{job.title}</strong>
              <div className="small muted">{statusLabel(job.status)}</div>
            </button>
          ))}
        </div>
        <div>
          {active ? (
            <>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0, fontSize: 18 }}>{active.title}</h2>
                <Badge tone={jobTone(active.status)}>{statusLabel(active.status)}</Badge>
              </div>
              {active.error ? <p className="small">{active.error}</p> : null}
              <pre className="log" style={{ marginTop: 12 }}>{log || 'El registro aparecerá aquí.'}</pre>
            </>
          ) : (
            <p className="muted">Elige un trabajo para ver el registro.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function ArtifactsScreen({ bridge }: { bridge: ReaBridge }) {
  const [items, setItems] = useState<ArtifactEntry[] | null>(null)
  const [current, setCurrent] = useState<string>('')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    bridge.listArtifacts().then(setItems).catch((reason: Error) => setError(reason.message))
  }, [bridge])

  async function open(relativePath: string) {
    setCurrent(relativePath)
    setError(null)
    try {
      const preview = await bridge.readArtifact(relativePath)
      if (preview.binary) {
        setText('')
        setNote('Archivo binario. No hay vista previa y no se ejecuta.')
      } else {
        setNote(preview.truncated ? `Vista recortada. Tamaño real: ${preview.bytes} bytes.` : `${preview.bytes} bytes.`)
        setText(preview.text)
      }
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page">
      <h1>Artefactos</h1>
      <p className="lead">Salidas escritas en la carpeta de trabajo. Se leen como texto y no se lanzan.</p>
      {error ? <p className="banner">{error}</p> : null}
      <div className="split">
        <div>
          {items && items.length === 0 ? <p className="muted small">Cuando termine un trabajo, sus archivos aparecerán aquí.</p> : null}
          {items?.map((item) => (
            <button key={item.relativePath} type="button" className="list-btn" aria-current={item.relativePath === current} onClick={() => void open(item.relativePath)}>
              <strong>{item.relativePath.split(/[/\\]/).pop()}</strong>
              <div className="path">{item.relativePath}</div>
              <div className="small muted">{item.bytes} bytes</div>
            </button>
          ))}
        </div>
        <div>
          {current ? (
            <>
              <p className="small muted">{note}</p>
              <pre className="log">{text || 'Sin texto que mostrar.'}</pre>
            </>
          ) : (
            <p className="muted">Selecciona un archivo.</p>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChatScreen({ bridge, state, e2e = false }: { bridge: ReaBridge; state: AppState; e2e?: boolean }) {
  const [providerId, setProviderId] = useState(state.providers[0]?.id ?? 'openai')
  const provider = state.providers.find((item) => item.id === providerId) ?? state.providers[0]
  const [prompt, setPrompt] = useState(e2e ? '¿Qué se puede decir de este archivo a partir de las salidas locales?' : '')
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [disclosure, setDisclosure] = useState<DisclosureView | null>(null)
  const [optIn, setOptIn] = useState(false)
  const [messages, setMessages] = useState<ChatLine[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void bridge.listChat().then(setMessages)
    void bridge.listArtifacts().then((items) => {
      setArtifacts(items)
      if (e2e && items[0]) setPicked([items[0].relativePath])
    })
    return bridge.onChatEvent((event) => {
      if (event.kind === 'delta') setDraft((prev) => prev + event.text)
      if (event.kind === 'done') {
        setBusy(false)
        setRequestId(null)
        if (event.status === 'succeeded') {
          setMessages((prev) => [...prev, { role: 'assistant', text: event.text, providerId, at: new Date().toISOString() }])
          setDraft('')
        } else setError(event.error || 'La respuesta no se completó.')
      }
    })
  }, [bridge, e2e, providerId])

  useEffect(() => {
    if (!e2e || !provider || picked.length === 0 || !prompt) return
    void bridge.prepareCloud({ providerId: provider.id, prompt, artifactRels: picked }).then((view) => {
      setDisclosure(view)
      setOptIn(false)
    }).catch(() => undefined)
  }, [e2e, bridge, provider, picked, prompt])

  function invalidate(nextPrompt = prompt, nextPicked = picked) {
    setPrompt(nextPrompt)
    setPicked(nextPicked)
    setDisclosure(null)
    setOptIn(false)
  }

  async function review() {
    if (!provider) return
    setError(null)
    try {
      setDisclosure(await bridge.prepareCloud({ providerId: provider.id, prompt, artifactRels: picked }))
      setOptIn(false)
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function send() {
    if (!provider || !disclosure) return
    setError(null)
    setBusy(true)
    setDraft('')
    setMessages((prev) => [...prev, { role: 'user', text: prompt, providerId: provider.id, at: new Date().toISOString() }])
    try {
      const { requestId: id } = await bridge.sendCloud({
        providerId: provider.id,
        prompt,
        artifactRels: picked,
        optIn,
        hash: disclosure.hash,
      })
      setRequestId(id)
    } catch (reason) {
      setBusy(false)
      setError(messageOf(reason))
    }
  }

  const configured = provider?.configured ? (provider.transport === 'cli' ? 'CLI presente' : 'Clave guardada') : 'No configurado'

  return (
    <div className="page">
      <h1>Conversación</h1>
      <p className="lead">El contexto no se envía al preparar el resumen. Sale del equipo solo después de la casilla de confirmación.</p>
      <div className="card" style={{ marginTop: 22 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div style={{ flex: 1 }}>
            <Label>Proveedor</Label>
            <select className="select" aria-label="Proveedor" value={provider?.id ?? ''} onChange={(event) => { setProviderId(event.target.value); setDisclosure(null); setOptIn(false) }}>
              {state.providers.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </div>
          <Badge tone={provider?.configured ? 'warn' : ''}>{configured}</Badge>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>{provider?.note}</p>
        <div style={{ marginTop: 14 }}>
          <Label>Pregunta</Label>
          <Area aria-label="Pregunta" value={prompt} onChange={(event) => invalidate(event.target.value, picked)} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Label>Salidas locales que quieres adjuntar</Label>
          {artifacts.length === 0 ? <p className="small muted">No hay salidas todavía. Puedes preguntar sin adjuntar nada.</p> : null}
          {artifacts.map((item) => (
            <div key={item.relativePath} style={{ marginTop: 8 }}>
              <CheckRow
                checked={picked.includes(item.relativePath)}
                onCheckedChange={(checked) => {
                  const next = checked ? [...picked, item.relativePath] : picked.filter((rel) => rel !== item.relativePath)
                  invalidate(prompt, next)
                }}
              >
                {item.relativePath}
              </CheckRow>
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button type="button" variant="secondary" disabled={!prompt.trim()} onClick={() => void review()}>
            Revisar qué saldrá
          </Button>
        </div>
      </div>
      {disclosure ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>{disclosure.leavesDevice ? 'Esto sale de este equipo' : 'Esto se envía a un servicio en este equipo'}</h2>
          <p className="small">Destino: {disclosure.destination}</p>
          <p className="small muted">Pregunta, {disclosure.promptBytes} bytes. {disclosure.promptPreview}</p>
          {disclosure.items.map((item) => (
            <p key={item.sha256} className="small">
              {item.name} · {item.bytes} bytes · {item.sha256.slice(0, 12)}
            </p>
          ))}
          <p className="small muted">Total aproximado: {disclosure.totalBytes} bytes.</p>
          <div style={{ marginTop: 10 }}>
            <CheckRow checked={optIn} onCheckedChange={setOptIn}>
              {disclosure.leavesDevice
                ? 'Entiendo que este texto se enviará al proveedor indicado.'
                : 'Entiendo que este texto se enviará al endpoint local indicado.'}
            </CheckRow>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <Button type="button" disabled={!optIn || busy || !provider?.configured} onClick={() => void send()}>
              {provider?.configured ? 'Enviar' : 'No configurado'}
            </Button>
            <Button type="button" variant="secondary" disabled={!requestId} onClick={() => requestId && void bridge.cancelCloud(requestId)}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
      {error ? <p className="banner" style={{ marginTop: 16 }}>{error}</p> : null}
      <div className="stack">
        {messages.map((message, index) => (
          <article key={`${message.at}-${index}`} className="card">
            <h3>{message.role === 'user' ? 'Tú' : 'Respuesta'}</h3>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{message.text}</p>
          </article>
        ))}
        {draft ? (
          <article className="card">
            <h3>Respuesta</h3>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{draft}</p>
          </article>
        ) : null}
        {messages.length === 0 && !draft ? <p className="muted small">Aún no hay mensajes en esta carpeta.</p> : null}
      </div>
    </div>
  )
}

export function SettingsScreen({
  bridge,
  state,
  onState,
}: {
  bridge: ReaBridge
  state: AppState
  onState: (state: AppState) => void
}) {
  const [checks, setChecks] = useState<Record<string, ProviderCheck>>({})
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const apiProviders = state.providers.filter((item) => item.transport === 'api')
  const cliProviders = state.providers.filter((item) => item.transport === 'cli')

  async function saveModel(id: string, model: string, endpoint?: string) {
    setError(null)
    try {
      const patch =
        id === 'openai' ? { openai: { model, endpoint } } :
        id === 'anthropic' ? { anthropic: { model, endpoint } } :
        id === 'xai' ? { xai: { model, endpoint } } :
        id === 'gemini' ? { gemini: { model, endpoint } } :
        id === 'compatible' ? { compatible: { model, endpoint } } :
        id === 'codex-cli' ? { codexCli: { model } } :
        id === 'claude-cli' ? { claudeCli: { model } } :
        { geminiCli: { model } }
      onState(await bridge.updateSettings({ providers: patch }))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  async function saveSecret(id: string) {
    setError(null)
    try {
      onState(await bridge.setSecret(id, secretDraft[id] ?? ''))
      setSecretDraft({ ...secretDraft, [id]: '' })
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page">
      <h1>Ajustes</h1>
      <p className="lead">
        {state.encryptionAvailable
          ? 'Las claves se guardan con el cifrado del sistema. No vuelven a mostrarse.'
          : 'El cifrado del sistema no está disponible. REA Studio no guardará claves en texto plano.'}
      </p>
      {error ? <p className="banner">{error}</p> : null}
      <div className="stack">
        {apiProviders.map((item) => (
          <ProviderCard
            key={item.id}
            itemId={item.id}
            label={item.label}
            model={item.model}
            endpoint={item.endpoint}
            configured={item.configured}
            note={item.note}
            check={checks[item.id]}
            secret={secretDraft[item.id] ?? ''}
            encryption={state.encryptionAvailable}
            onModel={(model, endpoint) => void saveModel(item.id, model, endpoint)}
            onSecret={(value) => setSecretDraft({ ...secretDraft, [item.id]: value })}
            onSaveSecret={() => void saveSecret(item.id)}
            onClear={async () => onState(await bridge.clearSecret(item.id))}
            onCheck={async () => setChecks({ ...checks, [item.id]: await bridge.checkProvider(item.id) })}
          />
        ))}
        {cliProviders.map((item) => (
          <article key={item.id} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>{item.label}</h2>
              <Badge tone={item.configured ? 'warn' : ''}>{item.configured ? 'CLI presente' : 'No configurado'}</Badge>
            </div>
            <p className="small muted">{item.note}</p>
            <PathEditor
              label="Ruta del ejecutable"
              name={item.label}
              value={state.settings.tools[item.id === 'codex-cli' ? 'codex' : item.id === 'claude-cli' ? 'claude' : 'gemini']}
              onChange={(value) =>
                onState({
                  ...state,
                  settings: {
                    ...state.settings,
                    tools: {
                      ...state.settings.tools,
                      [item.id === 'codex-cli' ? 'codex' : item.id === 'claude-cli' ? 'claude' : 'gemini']: value,
                    },
                  },
                })
              }
              onSave={() =>
                void bridge
                  .updateSettings({
                    tools: {
                      [item.id === 'codex-cli' ? 'codex' : item.id === 'claude-cli' ? 'claude' : 'gemini']:
                        state.settings.tools[item.id === 'codex-cli' ? 'codex' : item.id === 'claude-cli' ? 'claude' : 'gemini'],
                    },
                  })
                  .then(onState)
                  .catch((reason: Error) => setError(reason.message))
              }
            />
            <ModelRow
              model={item.model}
              onSave={(model) => void saveModel(item.id, model)}
            />
            {checks[item.id] ? <p className="small">{checkLabel(checks[item.id]!)}</p> : <p className="small muted">Conexión no comprobada.</p>}
            <Button type="button" variant="secondary" onClick={() => void bridge.checkProvider(item.id).then((result) => setChecks({ ...checks, [item.id]: result }))}>
              Comprobar CLI
            </Button>
          </article>
        ))}
      </div>
    </div>
  )
}

function ProviderCard(props: {
  itemId: string
  label: string
  model: string
  endpoint?: string
  configured: boolean
  note: string
  check?: ProviderCheck
  secret: string
  encryption: boolean
  onModel: (model: string, endpoint?: string) => void
  onSecret: (value: string) => void
  onSaveSecret: () => void
  onClear: () => Promise<void>
  onCheck: () => Promise<void>
}) {
  const [model, setModel] = useState(props.model)
  const [endpoint, setEndpoint] = useState(props.endpoint ?? '')
  useEffect(() => {
    setModel(props.model)
    setEndpoint(props.endpoint ?? '')
  }, [props.model, props.endpoint])
  return (
    <article className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{props.label}</h2>
        <Badge tone={props.configured ? 'warn' : ''}>{props.configured ? 'Clave guardada' : 'No configurado'}</Badge>
      </div>
      <p className="small muted">{props.note}</p>
      <div className="grid" style={{ marginTop: 12 }}>
        <div>
          <Label>Modelo</Label>
          <Field aria-label={`Modelo de ${props.label}`} value={model} onChange={(event) => setModel(event.target.value)} />
        </div>
        <div>
          <Label>Endpoint</Label>
          <Field aria-label={`Endpoint de ${props.label}`} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <Button type="button" variant="secondary" onClick={() => props.onModel(model, endpoint)}>Guardar modelo</Button>
      </div>
      <div style={{ marginTop: 12 }}>
        <Label>Clave</Label>
        <div className="row">
          <Field
            aria-label={`Clave de ${props.label}`}
            type="password"
            autoComplete="off"
            value={props.secret}
            placeholder={props.configured ? 'Hay una clave guardada' : 'No configurado'}
            disabled={!props.encryption}
            onChange={(event) => props.onSecret(event.target.value)}
          />
          <Button type="button" variant="secondary" disabled={!props.encryption || !props.secret} onClick={props.onSaveSecret}>
            Guardar clave
          </Button>
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <Button type="button" variant="secondary" onClick={() => void props.onCheck()}>Comprobar conexión</Button>
        <ConfirmDialog
          title={`Borrar la clave de ${props.label}`}
          body="Se elimina del almacén cifrado. La conversación guardada no incluye la clave."
          action="Borrar clave"
          onConfirm={() => void props.onClear()}
        />
      </div>
      <p className="small" style={{ marginTop: 10 }}>{props.check ? checkLabel(props.check) : 'Conexión no comprobada.'}</p>
    </article>
  )
}

function ModelRow({ model, onSave }: { model: string; onSave: (model: string) => void }) {
  const [value, setValue] = useState(model)
  useEffect(() => setValue(model), [model])
  return (
    <div className="row" style={{ marginTop: 12 }}>
      <Field aria-label="Modelo del CLI" value={value} placeholder="Vacío para el modelo del CLI" onChange={(event) => setValue(event.target.value)} />
      <Button type="button" variant="secondary" onClick={() => onSave(value)}>Guardar modelo</Button>
    </div>
  )
}

function checkLabel(check: ProviderCheck): string {
  if (check.state === 'not-configured') return 'No configurado.'
  if (check.state === 'present') return check.detail
  if (check.state === 'reachable') return check.detail
  if (check.state === 'rejected') return check.detail
  return check.detail
}

function workspaceName(state: AppState): string {
  const folder = state.settings.workspacePath
  if (!folder) return 'Sin carpeta'
  const parts = folder.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || folder
}

function toneOf(item: Detection): string {
  if (item.state === 'ready') return 'ready'
  if (item.state === 'unsupported') return 'warn'
  return ''
}

function labelOf(item: Detection): string {
  if (item.maturity === 'future') return 'Futuro'
  if (item.state === 'ready') return 'Lista'
  if (item.state === 'missing') return 'No encontrada'
  if (item.state === 'unsupported') return 'No implementada'
  return 'Sin comprobar'
}

function PathEditor({
  label,
  name,
  value,
  onChange,
  onSave,
}: {
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <Label>{label}</Label>
      <div className="row">
        <Field aria-label={`${label} de ${name}`} value={value} placeholder="Vacío para usar PATH" onChange={(event) => onChange(event.target.value)} />
        <Button type="button" variant="secondary" onClick={onSave}>
          Guardar
        </Button>
      </div>
    </div>
  )
}

function pathKey(id: string): keyof AppState['settings']['tools'] | null {
  const map: Record<string, keyof AppState['settings']['tools']> = {
    rea: 'rea',
    ghidra: 'ghidra',
    radare2: 'radare2',
    rizin: 'rizin',
    'codex-cli': 'codex',
  }
  return map[id] ?? null
}

function statusLabel(status: JobRecord['status']): string {
  if (status === 'running') return 'En curso'
  if (status === 'succeeded') return 'Terminado'
  if (status === 'failed') return 'Error'
  if (status === 'cancelled') return 'Cancelado'
  return 'Tiempo agotado'
}

function jobTone(status: JobRecord['status']): string {
  if (status === 'succeeded') return 'ready'
  if (status === 'failed' || status === 'timed-out') return 'bad'
  if (status === 'cancelled') return 'warn'
  return ''
}
