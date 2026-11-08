import { useEffect, useState } from 'react'
import type { AppState, Detection, ReaBridge } from '../../shared/types'
import { ArtifactsScreen, ChatScreen, HomeScreen, JobsScreen, Onboarding, SettingsScreen, ToolsScreen } from './screens'
import { Button } from './ui'

type Route = 'inicio' | 'herramientas' | 'trabajos' | 'artefactos' | 'conversacion' | 'ajustes'

const NAV: Array<{ id: Route; label: string }> = [
  { id: 'inicio', label: 'Inicio' },
  { id: 'herramientas', label: 'Herramientas' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'artefactos', label: 'Artefactos' },
  { id: 'conversacion', label: 'Conversación' },
  { id: 'ajustes', label: 'Ajustes' },
]

export function App() {
  const bridge = window.reaStudio
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [route, setRoute] = useState<Route>('inicio')
  const [detections, setDetections] = useState<Detection[] | null>(null)

  useEffect(() => {
    if (!bridge) {
      setError('Esta ventana no está conectada al proceso local de REA Studio.')
      return
    }
    bridge.getState().then(setState).catch((reason: Error) => setError(reason.message))
  }, [bridge])

  useEffect(() => {
    if (!state?.e2e || !bridge?.shot) return
    let cancel = false
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    void (async () => {
      for (const view of NAV.map((item) => item.id)) {
        if (cancel) return
        setRoute(view)
        if (view === 'herramientas') {
          try {
            setDetections(await bridge.detectTools())
          } catch (reason) {
            setError((reason as Error).message)
          }
        }
        await wait(view === 'conversacion' ? 900 : 600)
        await bridge.shot?.(view)
      }
      await bridge.shotDone?.()
    })()
    return () => {
      cancel = true
    }
  }, [state?.e2e, bridge])

  if (!bridge) {
    return (
      <div className="center">
        <div className="onboard">
          <h1>REA Studio</h1>
          <p className="lead">Esta interfaz necesita el proceso local. Ábrela desde la aplicación de escritorio.</p>
        </div>
      </div>
    )
  }
  if (error && !state) {
    return (
      <div className="center">
        <div className="onboard">
          <h1>No se pudo abrir</h1>
          <p className="banner">{error}</p>
          <Button type="button" onClick={() => window.location.reload()}>
            Reintentar
          </Button>
        </div>
      </div>
    )
  }
  if (!state) {
    return (
      <div className="center">
        <p className="muted">Cargando el espacio…</p>
      </div>
    )
  }
  if (!state.settings.onboardingComplete) {
    return <Onboarding bridge={bridge} state={state} onState={setState} />
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <strong>REA Studio</strong>
            <span>Versión {state.version}</span>
          </div>
        </div>
        <nav className="nav">
          {NAV.map((item) => (
            <button key={item.id} type="button" aria-current={route === item.id ? 'page' : undefined} onClick={() => setRoute(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        <p className="side-note">Análisis local. Solo archivos que tengas autorización para examinar.</p>
      </aside>
      <main className="main">
        {error ? <p className="banner">{error}</p> : null}
        {route === 'inicio' ? <HomeScreen bridge={bridge} state={state} onState={setState} onOpen={setRoute} /> : null}
        {route === 'herramientas' ? (
          <ToolsScreen bridge={bridge} state={state} onState={setState} detections={detections} onDetections={setDetections} />
        ) : null}
        {route === 'trabajos' ? <JobsScreen bridge={bridge} /> : null}
        {route === 'artefactos' ? <ArtifactsScreen bridge={bridge} /> : null}
        {route === 'conversacion' ? <ChatScreen bridge={bridge} state={state} e2e={state.e2e} /> : null}
        {route === 'ajustes' ? <SettingsScreen bridge={bridge} state={state} onState={setState} /> : null}
      </main>
    </div>
  )
}

export type { ReaBridge }
