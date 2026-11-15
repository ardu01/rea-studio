import { describe, expect, it } from 'vitest'
import {
  CHECK_GOOD_ENOUGH,
  CHECK_MAX_ROUNDS,
  assertNoAllowRun,
  craftGlobalArgs,
  formatAlike,
  parseCraftCheck,
  writeCraftConfigText,
} from '../src/core/copy/craft'

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
})
