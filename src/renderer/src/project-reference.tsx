import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ArtifactEntry } from '../../shared/types'
import type { ProjectContext } from './project'
import { Badge, Button } from './ui'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo completar la acción.'
}

/** Markdown mínimo de la ficha: títulos, listas, bloques de código y párrafos. */
export function FichaView({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  let list: string[] = []
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>)
    list = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (line.startsWith('```')) {
      flush()
      const block: string[] = []
      for (i++; i < lines.length && !lines[i]!.startsWith('```'); i++) block.push(lines[i]!)
      out.push(<pre key={`pre${out.length}`} className="ficha-code">{block.join('\n')}</pre>)
      continue
    }
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      continue
    }
    flush()
    if (line.startsWith('## ')) out.push(<h3 key={`h${out.length}`}>{line.slice(3)}</h3>)
    else if (line.startsWith('# ')) continue
    else if (line.trim()) out.push(<p key={`p${out.length}`} className="small muted">{inline(line)}</p>)
  }
  flush()
  return <div className="ficha">{out}</div>
}

function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  )
}

export function ReferencePanel({ ctx }: { ctx: ProjectContext }) {
  const { bridge, view } = ctx
  const project = view.project!
  const [ficha, setFicha] = useState<string | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([])
  const [picked, setPicked] = useState<string[]>(project.references)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const file = await bridge.projectRead('referencia/ficha.md')
      setFicha(file.binary ? null : file.text)
    } catch {
      setFicha(null)
    }
  }, [bridge])

  useEffect(() => {
    void load()
  }, [load, project.root])
  useEffect(() => setPicked(project.references), [project.references])

  async function startEditing() {
    setEditing(true)
    try {
      setArtifacts(await bridge.listArtifacts())
    } catch {
      setArtifacts([])
    }
  }

  async function update(references?: string[]) {
    setBusy(true)
    setError(null)
    try {
      ctx.update(await bridge.updateReferences(references))
      setEditing(false)
      await load()
      await ctx.refresh()
    } catch (reason) {
      setError(messageOf(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ marginTop: 0 }}>
      <article className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Ficha del análisis</h2>
          <div className="row">
            {ficha ? <Badge tone="ready">Solo lectura para el agente</Badge> : <Badge tone="bad">Falta la ficha</Badge>}
          </div>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          Análisis del programa original (funciones, importaciones, tipos y cadenas). Es obligatorio: el agente lo recibe siempre y copia la aplicación a partir de él. Se guarda en
          <span className="path"> referencia/ </span>
          y cada actualización es un commit.
        </p>
        <div style={{ marginTop: 10 }}>
          <span className="small muted">Artefactos: </span>
          {project.references.length ? project.references.map((ref) => <span key={ref} className="pill path">{ref}</span>) : <span className="small muted">ninguno</span>}
        </div>
        {editing ? (
          <div style={{ marginTop: 12 }}>
            {artifacts.length === 0 ? (
              <p className="small muted">No hay salidas de análisis en la carpeta de trabajo.</p>
            ) : (
              <div className="pick-list">
                {artifacts.slice(0, 60).map((item) => (
                  <label key={item.relativePath} className="pick">
                    <input
                      type="checkbox"
                      checked={picked.includes(item.relativePath)}
                      onChange={(event) => setPicked(event.target.checked ? [...picked, item.relativePath] : picked.filter((rel) => rel !== item.relativePath))}
                    />
                    <span className="path">{item.relativePath}</span>
                  </label>
                ))}
              </div>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <Button type="button" disabled={busy || picked.length === 0} onClick={() => void update(picked)}>{busy ? 'Generando…' : 'Guardar y generar ficha'}</Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancelar</Button>
            </div>
          </div>
        ) : (
          <div className="row" style={{ marginTop: 12 }}>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => void startEditing()}>Elegir artefactos…</Button>
            <Button type="button" disabled={busy || project.references.length === 0} onClick={() => void update()}>
              {busy ? 'Generando…' : ficha ? 'Regenerar ficha' : 'Generar ficha'}
            </Button>
          </div>
        )}
        {error ? <p className="banner" role="alert" style={{ marginTop: 12 }}>{error}</p> : null}
      </article>
      {ficha ? (
        <article className="card">
          <FichaView text={ficha} />
        </article>
      ) : null}
    </div>
  )
}
