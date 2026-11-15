import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ArtifactEntry, GitStep, ProjectFile, ProjectTemplateId, ProjectTree, ProjectView, ReaBridge } from '../../shared/types'
import { Badge, Button, Field, Label } from './ui'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción.'
}

export function DiffView({ text, empty = 'Sin cambios.' }: { text: string; empty?: string }) {
  if (!text.trim()) return <p className="small muted">{empty}</p>
  return (
    <pre className="code diff" aria-label="Diff">
      {text.split('\n').map((line, index) => {
        const cls =
          line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')
            ? 'hdr'
            : line.startsWith('@@')
              ? 'hunk'
              : line.startsWith('+')
                ? 'add'
                : line.startsWith('-')
                  ? 'del'
                  : ''
        return (
          <span key={index} className={cls}>
            {line}
            {'\n'}
          </span>
        )
      })}
    </pre>
  )
}

export function FileTree({ tree, selected, onSelect }: { tree: ProjectTree | null; selected: string | null; onSelect: (path: string) => void }) {
  if (!tree) return <p className="small muted">Cargando…</p>
  return (
    <div className="tree" role="tree" aria-label="Archivos del proyecto">
      {tree.entries.map((entry) => {
        const name = entry.path.split('/').pop() ?? entry.path
        const status = entry.status ? ` ${entry.status}` : ''
        const tone = entry.status === '?' || entry.status === 'A' ? 'new' : entry.status ? 'mod' : ''
        if (entry.kind !== 'file') {
          return (
            <div key={entry.path} role="treeitem" className="tree-dir" style={{ paddingLeft: 6 + entry.depth * 14 }}>
              {name}
              {entry.kind === 'dir' ? '/' : ' ↪'}
              {entry.skipped ? <span className="muted"> (no se recorre)</span> : null}
            </div>
          )
        }
        return (
          <button
            key={entry.path}
            type="button"
            role="treeitem"
            aria-selected={selected === entry.path}
            className={`tree-file ${tone} ${selected === entry.path ? 'sel' : ''}`}
            style={{ paddingLeft: 6 + entry.depth * 14 }}
            onClick={() => onSelect(entry.path)}
          >
            {name}
            <span className="muted">{status}</span>
          </button>
        )
      })}
      {tree.truncated ? <p className="small muted">Hay más archivos; el árbol está recortado.</p> : null}
    </div>
  )
}

export type ProjectTab = 'archivo' | 'cambios' | 'historial'

export function ProjectScreen({
  bridge,
  extraTabs = [],
}: {
  bridge: ReaBridge
  extraTabs?: Array<{ id: string; label: string; render: (ctx: ProjectContext) => ReactNode }>
}) {
  const [view, setView] = useState<ProjectView | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void bridge.projectState().then(setView).catch((reason) => setError(messageOf(reason)))
  }, [bridge])
  if (!view) return <div className="page"><h1>Proyecto</h1>{error ? <p className="banner">{error}</p> : null}</div>
  if (!view.project) return <NewProject bridge={bridge} view={view} onView={setView} />
  return <OpenProject bridge={bridge} view={view} onView={setView} extraTabs={extraTabs} />
}

function NewProject({ bridge, view, onView }: { bridge: ReaBridge; view: ProjectView; onView: (view: ProjectView) => void }) {
  const [name, setName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [template, setTemplate] = useState<ProjectTemplateId>('node')
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void bridge.listArtifacts().then(setArtifacts).catch(() => setArtifacts([]))
  }, [bridge])
  const summary = view.templates.find((item) => item.id === template)?.summary ?? ''

  async function create() {
    setBusy(true)
    setError(null)
    try {
      onView(await bridge.createProject({ parentDir, name, template, references: picked }))
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  async function openExisting() {
    setError(null)
    try {
      const dir = await bridge.chooseProjectFolder()
      if (dir) onView(await bridge.openProject(dir))
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  return (
    <div className="page">
      <h1>Proyecto</h1>
      <p className="lead">
        Crea una aplicación nueva en una carpeta local. El modelo local trabaja solo dentro de esa carpeta y usa el análisis como referencia, sin copiar el binario.
      </p>
      {!view.gitAvailable ? <p className="banner">No se encuentra git en PATH. El modo Proyecto lo necesita para poder deshacer cada paso.</p> : null}
      {error ? <p className="banner" role="alert">{error}</p> : null}
      <div className="stack">
        <article className="card">
          <h2>Nuevo proyecto</h2>
          <div className="grid" style={{ marginTop: 14, gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <Label>Nombre</Label>
              <Field aria-label="Nombre del proyecto" placeholder="mi-aplicacion" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div>
              <Label>Carpeta donde crearlo</Label>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <Field aria-label="Carpeta donde crear el proyecto" value={parentDir} onChange={(event) => setParentDir(event.target.value)} />
                <Button type="button" variant="secondary" onClick={async () => setParentDir((await bridge.chooseProjectParent()) ?? parentDir)}>
                  Elegir…
                </Button>
              </div>
            </div>
            <div>
              <Label>Plantilla</Label>
              <select className="select" aria-label="Plantilla" value={template} onChange={(event) => setTemplate(event.target.value as ProjectTemplateId)}>
                {view.templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <p className="small muted" style={{ marginTop: 6 }}>{summary}</p>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <Label>Artefactos de referencia</Label>
            {artifacts.length === 0 ? (
              <p className="small muted">No hay salidas de análisis en la carpeta de trabajo. Puedes crear el proyecto igualmente.</p>
            ) : (
              <div className="pick-list">
                {artifacts.slice(0, 40).map((item) => (
                  <label key={item.relativePath} className="pick">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.relativePath)}
                      onChange={(event) =>
                        setPicked(event.target.checked ? [...picked, item.relativePath] : picked.filter((rel) => rel !== item.relativePath))
                      }
                    />
                    <span className="path">{item.relativePath}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Se crea un repositorio git local: cada paso queda como un commit y se puede deshacer.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <Button type="button" disabled={busy || !name.trim() || !parentDir.trim() || !view.gitAvailable} onClick={() => void create()}>
              {busy ? 'Creando…' : 'Crear proyecto'}
            </Button>
          </div>
        </article>
        <article className="card">
          <h2>Abrir un proyecto existente</h2>
          <p className="small muted">Una carpeta creada antes con REA Studio (tiene rea-proyecto.json).</p>
          <div className="row" style={{ marginTop: 10 }}>
            <Button type="button" variant="secondary" onClick={() => void openExisting()}>Abrir carpeta…</Button>
          </div>
        </article>
      </div>
    </div>
  )
}

export interface ProjectContext {
  bridge: ReaBridge
  view: ProjectView
  refresh: () => Promise<void>
  select: (path: string) => void
}

function OpenProject({
  bridge,
  view,
  onView,
  extraTabs,
}: {
  bridge: ReaBridge
  view: ProjectView
  onView: (view: ProjectView) => void
  extraTabs: Array<{ id: string; label: string; render: (ctx: ProjectContext) => ReactNode }>
}) {
  const project = view.project!
  const [tree, setTree] = useState<ProjectTree | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [file, setFile] = useState<ProjectFile | null>(null)
  const [tab, setTab] = useState<string>(extraTabs[0]?.id ?? 'archivo')
  const [diff, setDiff] = useState('')
  const [history, setHistory] = useState<GitStep[]>([])
  const [confirmReset, setConfirmReset] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setTree(await bridge.projectTree())
      setDiff(await bridge.projectDiff())
      setHistory(await bridge.projectHistory())
    } catch (reason) {
      setError(messageOf(reason))
    }
  }, [bridge])

  useEffect(() => {
    void refresh()
  }, [refresh, project.root])

  const select = useCallback(
    (path: string) => {
      setSelected(path)
      setTab('archivo')
      void bridge
        .projectRead(path)
        .then(setFile)
        .catch((reason) => setError(messageOf(reason)))
    },
    [bridge],
  )

  async function act(fn: () => Promise<ProjectView>) {
    setError(null)
    try {
      onView(await fn())
      await refresh()
    } catch (reason) {
      setError(messageOf(reason))
    }
  }

  const ctx = useMemo<ProjectContext>(() => ({ bridge, view, refresh, select }), [bridge, view, refresh, select])
  const tabs = [...extraTabs.map((item) => ({ id: item.id, label: item.label })), { id: 'archivo', label: 'Archivo' }, { id: 'cambios', label: 'Cambios' }, { id: 'historial', label: 'Historial' }]
  const changes = tree?.entries.filter((entry) => entry.status).length ?? 0

  return (
    <div className="page wide">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1>Proyecto</h1>
          <p className="lead" style={{ marginTop: 8 }}>
            {project.name} · {project.templateLabel}
          </p>
          <p className="path muted">{project.root}</p>
        </div>
        <div className="row">
          <label className="auto-toggle" title="Los comandos permitidos se ejecutan sin preguntar. Instalar paquetes siempre pide confirmación.">
            <input
              type="checkbox"
              aria-label="Modo autónomo"
              checked={view.autonomous}
              onChange={(event) => void act(() => bridge.setAutonomous(event.target.checked))}
            />
            <span>Modo autónomo</span>
          </label>
          <Badge tone={view.autonomous ? 'warn' : ''}>{view.autonomous ? 'Sin preguntar (salvo instalar)' : 'Con confirmación'}</Badge>
          <Button type="button" variant="ghost" onClick={() => void refresh()}>Actualizar</Button>
          <Button type="button" variant="secondary" onClick={() => void act(() => bridge.closeProject())}>Cerrar proyecto</Button>
        </div>
      </div>
      {error ? <p className="banner" role="alert">{error}</p> : null}
      <div className="project-grid">
        <article className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <strong className="small">Archivos</strong>
            <span className="small muted">{changes ? `${changes} cambio${changes === 1 ? '' : 's'} sin guardar` : 'Sin cambios'}</span>
          </div>
          <FileTree tree={tree} selected={selected} onSelect={select} />
        </article>
        <div>
          <div className="tabs" role="tablist">
            {tabs.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'on' : ''} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {extraTabs.map((item) => (
              <div key={item.id} role="tabpanel" hidden={tab !== item.id}>
                {item.render(ctx)}
              </div>
            ))}
            {tab === 'archivo' ? (
              <article className="card">
                {file ? (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="path">{file.relativePath}</span>
                      <span className="small muted">{file.bytes.toLocaleString('es-ES')} bytes{file.truncated ? ' · recortado' : ''}</span>
                    </div>
                    {file.binary ? <p className="small muted">Archivo binario: no se muestra.</p> : <pre className="code" style={{ marginTop: 10 }}>{file.text}</pre>}
                  </>
                ) : (
                  <p className="small muted">Elige un archivo en el árbol.</p>
                )}
              </article>
            ) : null}
            {tab === 'cambios' ? (
              <article className="card">
                <h2>Cambios sin guardar</h2>
                <p className="small muted">Diferencias entre los archivos y el último commit.</p>
                <div style={{ marginTop: 10 }}>
                  <DiffView text={diff} />
                </div>
              </article>
            ) : null}
            {tab === 'historial' ? (
              <article className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h2>Historial git local</h2>
                  {confirmReset ? (
                    <div className="row">
                      <span className="small">¿Volver al estado inicial? Se crea un commit nuevo; el historial se conserva.</span>
                      <Button type="button" variant="danger" onClick={() => { setConfirmReset(false); void act(() => bridge.projectResetToStart()) }}>Sí, volver</Button>
                      <Button type="button" variant="ghost" onClick={() => setConfirmReset(false)}>Cancelar</Button>
                    </div>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => setConfirmReset(true)}>Volver al inicio…</Button>
                  )}
                </div>
                <div className="stack" style={{ marginTop: 12, gap: 8 }}>
                  {history.map((step, index) => (
                    <div key={step.id} className="step">
                      <div>
                        <div className="small">{step.message}</div>
                        <div className="path muted">
                          {step.id.slice(0, 8)} · {formatWhen(step.at)} · {step.author}
                        </div>
                      </div>
                      <div className="row">
                        {step.byRea && index < history.length - 1 ? (
                          <Button type="button" variant="secondary" onClick={() => void act(() => bridge.projectUndo(step.id))}>Deshacer este paso</Button>
                        ) : (
                          <Badge>{index === history.length - 1 ? 'Inicio' : 'Tuyo'}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
}
