import { vi } from 'vitest'
import { defaultSettings } from '../src/core/settings'
import { publicProviders } from '../src/core/providers'
import { PROJECT_TEMPLATES } from '../src/core/project/templates'
import type { AppState, ProjectView, ReaBridge } from '../src/shared/types'
import { bridgeFor } from './bridge'

export function readyState(): AppState {
  const settings = defaultSettings()
  settings.acceptedUseNotice = true
  settings.onboardingComplete = true
  settings.workspacePath = '/datos/analisis'
  return { version: '0.1.0', encryptionAvailable: true, e2e: false, settings, providers: publicProviders(settings, new Set()) }
}

export const templates = PROJECT_TEMPLATES.map((item) => ({ id: item.id, label: item.label, summary: item.summary }))

export const openView: ProjectView = {
  gitAvailable: true,
  autonomous: false,
  templates,
  agent: { model: 'hf.co/mradermacher/Huihui-Qwen3.5-9B-abliterated-GGUF:Q4_K_M', endpoint: 'http://127.0.0.1:11434/v1', local: true, running: null },
  project: {
    root: '/datos/proyectos/visor-registros',
    name: 'visor-registros',
    template: 'node',
    templateLabel: 'Node.js',
    createdAt: '2026-11-15T14:00:00.000Z',
    references: [],
    commands: [{ label: 'Probar', command: 'npm', args: ['test'] }],
  },
}

export function projectBridge(view: ProjectView = openView): ReaBridge {
  return {
    ...bridgeFor(readyState()),
    projectState: vi.fn(async () => view),
    projectTree: vi.fn(async () => ({
      truncated: false,
      entries: [
        { path: 'src', kind: 'dir' as const, depth: 0 },
        { path: 'src/index.js', kind: 'file' as const, depth: 1, bytes: 60, status: 'M' },
        { path: 'package.json', kind: 'file' as const, depth: 0, bytes: 120 },
      ],
    })),
    projectRead: vi.fn(async (rel: string) => ({ relativePath: rel, text: 'export const x = 1\n', bytes: 19, truncated: false, binary: false })),
    projectDiff: vi.fn(async () => 'diff --git a/src/index.js b/src/index.js\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1 +1 @@\n-uno\n+dos\n'),
    projectHistory: vi.fn(async () => [
      { id: 'b'.repeat(40), message: 'REA: escribe src/index.js', at: '2026-11-15T14:05:00.000Z', author: 'REA Studio', byRea: true },
      { id: 'a'.repeat(40), message: 'REA: crea el proyecto visor-registros (Node.js)', at: '2026-11-15T14:00:00.000Z', author: 'REA Studio', byRea: true },
    ]),
    projectUndo: vi.fn(async () => view),
  }
}

