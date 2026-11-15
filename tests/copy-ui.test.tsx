// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { defaultSettings } from '../src/core/settings'
import { publicProviders } from '../src/core/providers'
import type { AppState, CopyRunState, ProgramDetection } from '../src/shared/types'
import { CopyScreen } from '../src/renderer/src/copy'
import { App } from '../src/renderer/src/App'
import { bridgeFor } from './bridge'

function detection(partial: Partial<ProgramDetection> = {}): ProgramDetection {
  return {
    sourcePath: 'D:\\Apps\\Jerry.exe',
    sourceKind: 'file',
    name: 'jerry',
    kind: 'electron',
    kindLabel: 'Electron',
    template: 'node',
    templateLabel: 'Node.js',
    suggestedDest: 'D:\\Proyectos\\jerry',
    fileTarget: 'D:\\Apps\\resources\\app.asar',
    folderTarget: 'D:\\Apps',
    ...partial,
  }
}

function stateWithModel(): AppState {
  const settings = defaultSettings()
  settings.acceptedUseNotice = true
  settings.onboardingComplete = true
  settings.workspacePath = '/tmp/rea-studio-ui'
  settings.providers.compatible.model = 'llama3'
  settings.providers.compatible.endpoint = 'http://127.0.0.1:11434'
  return {
    version: '0.1.0',
    encryptionAvailable: true,
    e2e: false,
    settings,
    providers: publicProviders(settings, new Set()),
  }
}

function running(partial: Partial<CopyRunState> = {}): CopyRunState {
  return {
    status: 'running',
    step: 'analizando',
    progress: 18,
    sourcePath: 'D:\\Apps\\Jerry.exe',
    destPath: 'D:\\Proyectos\\jerry',
    destParent: 'D:\\Proyectos',
    detection: detection(),
    details: ['12:00  Detectado: Electron'],
    projectRoot: null,
    summary: null,
    check: null,
    packageRequest: null,
    ...partial,
  }
}

describe('pantalla Copiar aplicación', () => {
  it('el inicio del programa es el modo sencillo y pide un modelo si no hay ninguno', async () => {
    const settings = defaultSettings()
    settings.acceptedUseNotice = true
    settings.onboardingComplete = true
    settings.workspacePath = '/tmp/rea-studio-ui'
    settings.providers.compatible.model = ''
    const state: AppState = {
      version: '0.1.0',
      encryptionAvailable: true,
      e2e: false,
      settings,
      providers: publicProviders(settings, new Set()),
    }
    window.reaStudio = bridgeFor(state)
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Copiar aplicación' })).toBeTruthy()
    expect(screen.getByText(/hace falta un modelo local/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Elige o descarga un modelo' })).toBeTruthy()
    expect(screen.getByText('Avanzado')).toBeTruthy()
  })

  it('acepta Electron y muestra Pendiente al terminar', async () => {
    const state = stateWithModel()
    const bridge = bridgeFor(state)
    const found = detection()
    bridge.chooseFile = async () => found.sourcePath
    bridge.detectProgram = async () => found
    let copyListener: ((run: CopyRunState) => void) | undefined
    bridge.onCopyEvent = (cb) => {
      copyListener = cb
      return () => undefined
    }
    bridge.startCopy = async () => {
      const done = running({
        status: 'done',
        step: 'listo',
        progress: 100,
        projectRoot: 'D:\\Proyectos\\jerry',
        summary: {
          copied: 'Se reprodujo la interfaz de Jerry.',
          improved: 'Añadí un registro de actividad.',
          pending: 'No se ha podido copiar el módulo nativo de notificaciones.',
          alike: 87,
        },
        check: { round: 1, maxRounds: 3, alike: 87, pending: 'No se ha podido copiar el módulo nativo de notificaciones.', goodEnough: 90 },
      })
      copyListener?.(done)
      return done
    }
    window.reaStudio = bridge
    render(<CopyScreen bridge={bridge} state={state} onOpenSettings={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Elegir archivo…' }))
    expect(await screen.findByText('Detectado: Electron')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(await screen.findByRole('heading', { name: 'Parecido' })).toBeTruthy()
    expect(screen.getByText(/87 % de parecido con el original/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Se copió del original' })).toBeTruthy()
    expect(screen.getByText(/interfaz de Jerry/)).toBeTruthy()
    expect(screen.getByText(/registro de actividad/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Pendiente' })).toBeTruthy()
    expect(screen.getByText(/módulo nativo de notificaciones/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Abrir carpeta' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Ejecutar' })).toBeTruthy()
  })

  it('tiene cinco pasos, Cancelar y Ver detalles plegado', async () => {
    const state = stateWithModel()
    const bridge = bridgeFor(state)
    bridge.copyState = async () => running()
    render(<CopyScreen bridge={bridge} state={state} onOpenSettings={() => undefined} />)
    expect(await screen.findByText(/paso 1 de 6/i)).toBeTruthy()
    expect(screen.getByText('Analizando')).toBeTruthy()
    expect(screen.getByText('Creando proyecto')).toBeTruthy()
    expect(screen.getByText('Copiando')).toBeTruthy()
    expect(screen.getByText('Comprobando')).toBeTruthy()
    expect(screen.getByText('Mejorando')).toBeTruthy()
    expect(screen.getByText('Listo')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy()
    expect(screen.getByText('Ver detalles')).toBeTruthy()
    expect(screen.queryByText('12:00  Detectado: Electron')).toBeNull()
  })

  it('no deja pulsar Copiar si el archivo no es una aplicación', async () => {
    const state = stateWithModel()
    const bridge = bridgeFor(state)
    bridge.chooseFile = async () => 'D:\\notas.txt'
    bridge.detectProgram = async () =>
      detection({
        sourcePath: 'D:\\notas.txt',
        name: 'notas',
        kind: 'unknown',
        kindLabel: 'No reconocido',
        template: null,
        templateLabel: null,
        reason: 'No parece una aplicación.',
        suggestedDest: 'D:\\Proyectos\\notas',
      })
    render(<CopyScreen bridge={bridge} state={state} onOpenSettings={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'Elegir archivo…' }))
    expect(await screen.findByText('No reconocido')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Copiar' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

