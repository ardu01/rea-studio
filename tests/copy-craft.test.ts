import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHECK_GOOD_ENOUGH,
  CHECK_MAX_ROUNDS,
  assertNoAllowRun,
  craftRebuildCheckArgs,
  craftGlobalArgs,
  formatAlike,
  parseCraftCheck,
  writeCraftConfigText,
} from '../src/core/copy/craft'
import { craftAnythingAdapter } from '../src/core/adapters'

describe('Craft Anything en el modo sencillo', () => {
  it('nunca añade --allow-run y aísla la configuración', () => {
    const args = [...craftGlobalArgs(), 'triage', 'D:/Apps/Jerry.exe']
    expect(args).toContain('--deep')
    expect(args).toContain('--format')
    expect(args).not.toContain('--allow-run')
    expect(() => assertNoAllowRun(args)).not.toThrow()
    expect(() => assertNoAllowRun(['--deep', '--allow-run', 'triage', 'x'])).toThrow(/no se lanza sin confirmación/)
    const toml = writeCraftConfigText({
      storeDir: 'D:/Analisis/craft/engines',
      ghidraDir: 'D:/REA/tools/ghidra',
      javaHome: 'D:/REA/tools/jdk',
    })
    expect(toml).toMatch(/deep_mode = true/)
    expect(toml).toMatch(/runtime_study = false/)
    expect(toml).toMatch(/ask_before_running = true/)
    expect(toml).toContain('install_dir = "D:/REA/tools/ghidra"')
    expect(toml).toContain('java_home = "D:/REA/tools/jdk"')
    expect(toml).toContain('version = 3')
  })

  it('lee el porcentaje de parecido y lo pendiente, sin inventar cifras', () => {
    const json = parseCraftCheck('{"alike": 87.4, "pending": "Falta el módulo de notificaciones."}')
    expect(json.alike).toBeCloseTo(87.4)
    expect(json.pending).toMatch(/notificaciones/)
    const text = parseCraftCheck('Reproducción: menú.\nPendiente: no coincide el arranque.\nLa build está 82% alike (needs 90%)')
    expect(text.alike).toBe(82)
    expect(text.pending).toMatch(/arranque/)
    expect(parseCraftCheck('Todo bien, sin cifras.').alike).toBeNull()
    expect(formatAlike(null)).toMatch(/sin un porcentaje medido/i)
    expect(formatAlike(87.4)).toBe('87 % de parecido.')
    expect(CHECK_MAX_ROUNDS).toBe(3)
    expect(CHECK_GOOD_ENOUGH).toBe(90)
  })

  it('trata el error JSON de la CLI como «no ha comparado», sin porcentaje', () => {
    const parsed = parseCraftCheck('{"error":{"category":"missing","code":"not_found","message":"/x isn\'t a project folder: /x/craft.json: No such file"}}')
    expect(parsed.usedCraft).toBe(false)
    expect(parsed.alike).toBeNull()
    expect(parsed.reason).toMatch(/craft\.json/)
    expect(parseCraftCheck('{"result":{"alike":91}}').alike).toBe(91)
  })

  it('rebuild-check usa las opciones reales de la 0.6.1 y nunca --allow-run', () => {
    const args = craftRebuildCheckArgs('/copia', 999)
    expect(args).toEqual(['--deep', '--format', 'json', 'rebuild-check', '--project', '/copia', '--wait-minutes', '60'])
    expect(craftRebuildCheckArgs('/copia', 0)).toContain('1')
  })

  it('el estudio y el informe comparten proyecto y no pasan variables inventadas', () => {
    const common = { jobDir: '/ws/jobs/j', timeoutMs: 1000, resourcesDir: '/r', configured: { craftAnything: '/opt/craft/craft-anything-cli' }, platform: 'linux' as const, pathEnv: '' }
    const triage = craftAnythingAdapter.plan('triage', { ...common, outputDir: '/ws/jobs/j/output', targetPath: '/app/app.exe' })
    if (triage.kind !== 'process') throw new Error('proceso')
    expect(triage.args).toEqual(['--deep', '--format', 'json', '--project', path.join('/ws/jobs/j/output', 'craft-project'), 'triage', '/app/app.exe'])
    expect(Object.keys(triage.env ?? {})).toEqual(['CRAFT_ANYTHING_CONFIG_DIR'])
    const report = craftAnythingAdapter.plan('report', { ...common, outputDir: '/ws/jobs/k/output', targetPath: '/ws/jobs/j/output/craft-project' })
    if (report.kind !== 'process') throw new Error('proceso')
    expect(report.args).toEqual(['--deep', '--format', 'json', '--project', '/ws/jobs/j/output/craft-project', 'report', '--out', path.join('/ws/jobs/k/output', 'craft-report.md')])
    expect(() => craftAnythingAdapter.plan('report', { ...common, outputDir: '/o' })).toThrow(/carpeta del proyecto/)
    const spec = craftAnythingAdapter.actions.find((item) => item.id === 'report')
    expect(spec).toMatchObject({ needsTarget: true, targetKind: 'directory' })
  })
})

