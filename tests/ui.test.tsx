// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { App } from '../src/renderer/src/App'
import { defaultSettings } from '../src/core/settings'
import { publicProviders } from '../src/core/providers'
import type { AppState } from '../src/shared/types'
import { bridgeFor } from './bridge'

describe('humo de la interfaz', () => {
  it('muestra el aviso de uso y no una conexión fingida', async () => {
    const settings = defaultSettings()
    const state: AppState = {
      version: '0.1.0',
      encryptionAvailable: false,
      e2e: false,
      settings,
      providers: publicProviders(settings, new Set()),
    }
    window.reaStudio = bridgeFor(state)
    render(<App />)
    expect(await screen.findByText(/autorización para estudiar/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })

  it('en ajustes dice no configurado cuando no hay claves', async () => {
    const settings = defaultSettings()
    settings.acceptedUseNotice = true
    settings.onboardingComplete = true
    settings.workspacePath = '/tmp/rea-studio-ui'
    const state: AppState = {
      version: '0.1.0',
      encryptionAvailable: true,
      e2e: false,
      settings,
      providers: publicProviders(settings, new Set()),
    }
    window.reaStudio = bridgeFor(state)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ajustes' }))
    const missing = await screen.findAllByText('No configurado')
    expect(missing.length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Conectado$/)).toBeNull()
  })
})
