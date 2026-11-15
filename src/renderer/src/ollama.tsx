import { useCallback, useEffect, useRef, useState } from 'react'
import type { OllamaEvent, OllamaListResult, OllamaModel, ReaBridge } from '../../shared/types'
import { OLLAMA_SUGGESTIONS, isLocalEndpoint } from '../../core/ollama'
import { Badge, Button, Field } from './ui'

const MANUAL = '__manual__'
const MISSING = '__missing__'

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return ''
  const gb = bytes / 1e9
  if (gb >= 1) return `${gb.toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GB`
  return `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString('es-ES')} MB`
}

export function sameModel(a: string, b: string): boolean {
  const norm = (value: string) => value.trim().toLowerCase().replace(/:latest$/, '')
  return norm(a) === norm(b)
}

export interface PullState {
  requestId: string
  model: string
  status: string
  completed: number | null
  total: number | null
}

export interface OllamaControls {
  enabled: boolean
  list: OllamaListResult | null
  installed: OllamaModel[]
  loading: boolean
  pull: PullState | null
  pullError: string | null
  pullDone: string | null
  refresh: () => Promise<void>
  startPull: (name: string) => Promise<void>
  cancelPull: () => Promise<void>
}

/**
 * Estado de Ollama para el proveedor compatible. Toda la red va por el proceso
 * principal (IPC); aquí solo se guarda el estado de la pantalla.
 */
export function useOllama(opts: {
  bridge: ReaBridge
  active: boolean
  savedEndpoint: string
  onPulled: (model: string) => void
}): OllamaControls {
  const { bridge, active, savedEndpoint, onPulled } = opts
  const enabled = active && isLocalEndpoint(savedEndpoint)
  const [list, setList] = useState<OllamaListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [pull, setPull] = useState<PullState | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [pullDone, setPullDone] = useState<string | null>(null)
  const pullRef = useRef<string | null>(null)
  const pulledRef = useRef(onPulled)
  pulledRef.current = onPulled

  const refresh = useCallback(async () => {
    if (!enabled) {
      setList(null)
      return
    }
    setLoading(true)
    try {
      setList(await bridge.listOllamaModels())
    } catch (error) {
      setList({ available: false, base: null, models: [], detail: error instanceof Error ? error.message : 'No se pudo consultar Ollama.' })
    } finally {
      setLoading(false)
    }
  }, [bridge, enabled])

  useEffect(() => {
    void refresh()
  }, [refresh, savedEndpoint])

  useEffect(() => {
    if (!active) return undefined
    return bridge.onOllamaEvent((event: OllamaEvent) => {
      if (event.requestId !== pullRef.current) return
      if (event.kind === 'progress') {
        setPull((current) =>
          current
            ? {
                ...current,
                status: event.status || current.status,
                completed: event.completed ?? current.completed,
                total: event.total ?? current.total,
              }
            : current,
        )
        return
      }
      pullRef.current = null
      setPull(null)
      if (event.status === 'succeeded') {
        setPullDone(`«${event.model}» descargado. Está elegido arriba: pulsa «Guardar modelo» para usarlo.`)
        pulledRef.current(event.model)
        void refresh()
      } else {
        setPullError(event.error ?? (event.status === 'cancelled' ? 'Descarga cancelada.' : 'La descarga falló.'))
      }
    })
  }, [active, bridge, refresh])

  const startPull = useCallback(
    async (name: string) => {
      const target = name.trim()
      if (!target || pullRef.current) return
      setPullError(null)
      setPullDone(null)
      try {
        const { requestId } = await bridge.pullOllamaModel(target)
        pullRef.current = requestId
        setPull({ requestId, model: target, status: 'Preparando la descarga', completed: null, total: null })
      } catch (error) {
        setPullError(error instanceof Error ? error.message : 'No se pudo empezar la descarga.')
      }
    },
    [bridge],
  )

  const cancelPull = useCallback(async () => {
    const id = pullRef.current
    if (!id) return
    try {
      await bridge.cancelOllamaPull(id)
    } catch (error) {
      setPullError(error instanceof Error ? error.message : 'No se pudo cancelar.')
    }
  }, [bridge])

  return {
    enabled,
    list,
    installed: list?.available ? list.models : [],
    loading,
    pull,
    pullError,
    pullDone,
    refresh,
    startPull,
    cancelPull,
  }
}

export function OllamaModelField({
  ollama,
  label,
  model,
  onModel,
}: {
  ollama: OllamaControls
  label: string
  model: string
  onModel: (model: string) => void
}) {
  const [manual, setManual] = useState(false)
  const { installed } = ollama
  const showSelect = !!ollama.list?.available && installed.length > 0 && !manual
  const match = installed.find((item) => sameModel(item.name, model))?.name
  const selectValue = match ?? (model ? MISSING : '')
  return (
    <div>
      {showSelect ? (
        <select
          className="select"
          aria-label={`Modelo de ${label}`}
          value={selectValue}
          onChange={(event) => {
            const value = event.target.value
            if (value === MANUAL) setManual(true)
            else if (value !== MISSING) onModel(value)
          }}
        >
          {selectValue === MISSING ? <option value={MISSING}>{model} (no instalado)</option> : null}
          {installed.map((item) => (
            <option key={item.name} value={item.name}>
              {[item.name, item.parameterSize, item.quantization, formatBytes(item.bytes)].filter(Boolean).join(' · ')}
            </option>
          ))}
          <option value={MANUAL}>Escribir otro a mano…</option>
        </select>
      ) : (
        <Field aria-label={`Modelo de ${label}`} value={model} onChange={(event) => onModel(event.target.value)} />
      )}
      {ollama.enabled ? (
        <div className="row small muted" style={{ marginTop: 6, gap: 4 }}>
          <span>{ollama.loading ? 'Consultando Ollama…' : ollama.list?.detail ?? ''}</span>
          {manual && installed.length > 0 ? (
            <Button type="button" variant="ghost" onClick={() => setManual(false)}>
              Ver instalados
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => void ollama.refresh()} disabled={ollama.loading}>
            Actualizar lista
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export function OllamaDownloads({ ollama }: { ollama: OllamaControls }) {
  const [custom, setCustom] = useState('')
  if (!ollama.enabled || !ollama.list?.available) return null
  const { pull } = ollama
  const busy = !!pull
  const isInstalled = (name: string) => ollama.installed.some((item) => sameModel(item.name, name))
  const percent = pull?.total && pull.completed !== null ? Math.min(100, Math.floor((pull.completed / pull.total) * 100)) : null
  return (
    <section className="ollama" aria-label="Descargar modelos con Ollama">
      <h3>Descargar modelo</h3>
      <p className="small muted">
        Ollama descarga el modelo en este equipo. Los de Hugging Face se piden con la forma hf.co/usuario/repo:cuantización.
      </p>
      <div className="suggest">
        {OLLAMA_SUGGESTIONS.map((item) => {
          const have = isInstalled(item.name)
          return (
            <div key={item.name} className="suggest-item">
              <div>
                <div className="row" style={{ gap: 8 }}>
                  <strong className="small">{item.label}</strong>
                  {item.uncensored ? <Badge tone="warn">Sin censura</Badge> : null}
                  {item.bytes ? <span className="small muted">{formatBytes(item.bytes)}</span> : null}
                </div>
                <div className="path muted" style={{ marginTop: 2 }}>{item.name}</div>
                <div className="small muted">{item.hint}</div>
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || have}
                aria-label={`Descargar ${item.label}`}
                onClick={() => void ollama.startPull(item.name)}
              >
                {have ? 'Instalado' : 'Descargar'}
              </Button>
            </div>
          )
        })}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Field
            aria-label="Modelo para descargar"
            placeholder="Otro modelo: nombre de Ollama o hf.co/usuario/repo:Q4_K_M"
            value={custom}
            disabled={busy}
            onChange={(event) => setCustom(event.target.value)}
          />
        </div>
        <Button type="button" disabled={busy || !custom.trim()} onClick={() => void ollama.startPull(custom)}>
          Descargar modelo
        </Button>
      </div>
      {pull ? (
        <div role="status" style={{ marginTop: 12 }}>
          <div className="row small" style={{ justifyContent: 'space-between' }}>
            <span>
              {pull.status} <span className="muted">· {pull.model}</span>
            </span>
            <span className="muted">
              {percent !== null ? `${percent} % · ${formatBytes(pull.completed)} de ${formatBytes(pull.total)}` : ''}
            </span>
          </div>
          <div className="meter" aria-hidden="true">
            <span style={{ width: `${percent ?? 0}%` }} />
          </div>
          <Button type="button" variant="danger" onClick={() => void ollama.cancelPull()}>
            Cancelar descarga
          </Button>
        </div>
      ) : null}
      {ollama.pullError ? <p className="banner" role="alert" style={{ marginTop: 12 }}>{ollama.pullError}</p> : null}
      {ollama.pullDone ? <p className="small" style={{ marginTop: 12 }}>{ollama.pullDone}</p> : null}
    </section>
  )
}
