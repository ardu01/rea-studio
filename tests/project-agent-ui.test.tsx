// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import type { AgentEvent, ProjectView } from '../src/shared/types'
import { openView, projectBridge } from './project-fixtures'

function setup(view: ProjectView = openView) {
  let listener: ((event: AgentEvent) => void) | null = null
  const bridge = {
    ...projectBridge(view),
    startAgent: vi.fn(async () => ({ runId: 'ag-1' })),
    answerAgent: vi.fn(async () => undefined),
    cancelAgent: vi.fn(async () => undefined),
    onAgentEvent: (cb: (event: AgentEvent) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    },
  }
  window.reaStudio = bridge
  return { bridge, emit: (event: AgentEvent) => act(async () => listener?.(event)) }
}

async function openAgent() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Proyecto' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Agente' }))
}

describe('agente en la pantalla Proyecto', () => {
  it('lanza el objetivo, pide aprobar el diff y muestra el final', async () => {
    const { bridge, emit } = setup()
    await openAgent()
    expect(screen.getByText('Ollama en localhost')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Objetivo para el agente'), { target: { value: 'Arregla la suma' } })
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }))
    await waitFor(() => expect(bridge.startAgent).toHaveBeenCalledWith({ goal: 'Arregla la suma' }))
    expect(await screen.findByText('Arregla la suma')).toBeTruthy()
    await emit({ kind: 'tool', runId: 'ag-1', callId: 'c1', tool: 'leer', summary: 'leer("src/index.js")', status: 'ok', detail: undefined })
    expect(screen.getByText('leer("src/index.js")')).toBeTruthy()
    await emit({
      kind: 'approval',
      runId: 'ag-1',
      callId: 'c2',
      request: { type: 'write', path: 'src/index.js', created: false, added: 1, removed: 1, diff: '--- a/src/index.js\n+++ b/src/index.js\n@@ -1 +1 @@\n-a - b\n+a + b\n' },
    })
    const region = screen.getByRole('region', { name: 'Cambio propuesto' })
    expect(within(region).getByText('+a + b')).toBeTruthy()
    fireEvent.click(within(region).getByRole('button', { name: 'Aceptar cambio' }))
    expect(bridge.answerAgent).toHaveBeenCalledWith({ runId: 'ag-1', callId: 'c2', approve: true })
    expect(screen.queryByRole('region', { name: 'Cambio propuesto' })).toBeNull()
    await emit({ kind: 'end', runId: 'ag-1', status: 'finished', text: 'Suma corregida y pruebas en verde.' })
    expect(screen.getByText('Suma corregida y pruebas en verde.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Empezar' })).toBeTruthy()
  })

  it('pide permiso para comandos del modelo y deja detener', async () => {
    const { bridge, emit } = setup()
    await openAgent()
    fireEvent.change(screen.getByLabelText('Objetivo para el agente'), { target: { value: 'Instala algo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Empezar' }))
    await screen.findByRole('button', { name: 'Detener' })
    await emit({
      kind: 'approval',
      runId: 'ag-1',
      callId: 'c1',
      request: { type: 'command', check: { allowed: true, kind: 'install', network: true, display: 'npm install left-pad', command: 'npm', args: ['install', 'left-pad'] } },
    })
    const dialog = screen.getByRole('dialog', { name: '¿Ejecutar este comando?' })
    expect(dialog).toHaveTextContent('npm install left-pad')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rechazar' }))
    expect(bridge.answerAgent).toHaveBeenCalledWith({ runId: 'ag-1', callId: 'c1', approve: false })
    fireEvent.click(screen.getByRole('button', { name: 'Detener' }))
    expect(bridge.cancelAgent).toHaveBeenCalledWith('ag-1')
  })

  it('no deja empezar si el modelo no es local', async () => {
    setup({ ...openView, agent: { model: 'gpt-x', endpoint: 'https://api.example.com/v1', local: false, running: null } })
    await openAgent()
    expect(screen.getByText('El endpoint no es local')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Objetivo para el agente'), { target: { value: 'x' } })
    expect((screen.getByRole('button', { name: 'Empezar' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
