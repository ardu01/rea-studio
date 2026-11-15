// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../src/renderer/src/App'
import { defaultSettings } from '../src/core/settings'
import { publicProviders } from '../src/core/providers'
import type { AppState, OllamaEvent, ReaBridge } from '../src/shared/types'
import { bridgeFor } from './bridge'

function readyState(endpoint?: string): AppState {
  const settings = defaultSettings()
  settings.acceptedUseNotice = true
  settings.onboardingComplete = true
  settings.workspacePath = '/tmp/rea-studio-ui'
  if (endpoint) settings.providers.compatible.endpoint = endpoint
  return { version: '0.1.0', encryptionAvailable: true, e2e: false, settings, providers: publicProviders(settings, new Set()) }
}

function withOllama(state: AppState) {
  let listener: ((event: OllamaEvent) => void) | null = null
  const models = [
    { name: 'llama3.2:latest', bytes: 2_019_393_189, parameterSize: '3.2B', quantization: 'Q4_K_M' },
  ]
  const bridge: ReaBridge = {
    ...bridgeFor(state),
    listOllamaModels: vi.fn(async () => ({ available: true, base: 'http://127.0.0.1:11434', models: [...models], detail: `${models.length} modelo en Ollama.` })),
    pullOllamaModel: vi.fn(async () => ({ requestId: 'pull-1' })),
    cancelOllamaPull: vi.fn(async () => undefined),
    onOllamaEvent: (cb) => {
      listener = cb
      return () => {
        listener = null
      }
    },
  }
  return { bridge, emit: (event: OllamaEvent) => listener?.(event), models }
}

async function openSettings() {
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }))
}

describe('Ollama en ajustes', () => {
  it('muestra un desplegable con los modelos instalados y permite escribir uno a mano', async () => {
    const { bridge } = withOllama(readyState())
    window.reaStudio = bridge
    await openSettings()
    const select = (await screen.findByRole('combobox', { name: 'Modelo de OpenAI compatible' })) as HTMLSelectElement
    expect(within(select).getByText(/llama3\.2:latest · 3\.2B · Q4_K_M/)).toBeTruthy()
    expect(select.value).toBe('llama3.2:latest')
    fireEvent.change(select, { target: { value: '__manual__' } })
    expect(await screen.findByRole('textbox', { name: 'Modelo de OpenAI compatible' })).toBeTruthy()
    expect(screen.getByText('Servidor local')).toBeTruthy()
  })

  it('ofrece los tres modelos sin censura y muestra progreso, cancelación y error', async () => {
    const { bridge, emit } = withOllama(readyState())
    window.reaStudio = bridge
    await openSettings()
    expect(await screen.findAllByText('Sin censura')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Descargar Qwen3.5 9B sin censura (Huihui, Q4_K_M)' }))
    await waitFor(() => expect(bridge.pullOllamaModel).toHaveBeenCalledWith('hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M'))
    await act(async () => {
      emit({ kind: 'progress', requestId: 'pull-1', model: 'x', status: 'Descargando', completed: 2_500_000_000, total: 5_000_000_000 })
    })
    expect(await screen.findByText(/50 % · 2,5 GB de 5,0 GB/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Descargar modelo' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar descarga' }))
    await waitFor(() => expect(bridge.cancelOllamaPull).toHaveBeenCalledWith('pull-1'))
    await act(async () => {
      emit({ kind: 'done', requestId: 'pull-1', model: 'x', status: 'cancelled', error: 'Descarga cancelada.' })
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Descarga cancelada.')
    expect(screen.queryByRole('button', { name: 'Cancelar descarga' })).toBeNull()
  })

  it('al terminar refresca la lista y deja elegido el modelo descargado', async () => {
    const { bridge, emit, models } = withOllama(readyState())
    window.reaStudio = bridge
    await openSettings()
    fireEvent.change(await screen.findByRole('textbox', { name: 'Modelo para descargar' }), { target: { value: 'qwen3:8b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar modelo' }))
    await waitFor(() => expect(bridge.pullOllamaModel).toHaveBeenCalledWith('qwen3:8b'))
    models.push({ name: 'qwen3:8b', bytes: 5_200_000_000, parameterSize: '8.2B', quantization: 'Q4_K_M' })
    await act(async () => {
      emit({ kind: 'done', requestId: 'pull-1', model: 'qwen3:8b', status: 'succeeded' })
    })
    await waitFor(() => {
      const select = screen.getByRole('combobox', { name: 'Modelo de OpenAI compatible' }) as HTMLSelectElement
      expect(select.value).toBe('qwen3:8b')
    })
    expect(screen.getByText(/descargado/)).toBeTruthy()
  })

  it('con un endpoint remoto no consulta Ollama y deja el campo libre', async () => {
    const { bridge } = withOllama(readyState('https://proxy.example.com/v1'))
    window.reaStudio = bridge
    await openSettings()
    expect(await screen.findByRole('textbox', { name: 'Modelo de OpenAI compatible' })).toBeTruthy()
    expect(bridge.listOllamaModels).not.toHaveBeenCalled()
    expect(screen.queryByText('Descargar modelo')).toBeNull()
  })
})
