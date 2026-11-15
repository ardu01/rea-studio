import { describe, expect, it } from 'vitest'
import { firstVersionLine } from '../src/core/adapters'

describe('firstVersionLine', () => {
  it('recorta el retorno de carro de Windows en la primera línea', () => {
    expect(firstVersionLine('radare2 5.9.0\r\nbuilt with...')).toBe('radare2 5.9.0')
    expect(firstVersionLine('rizin 0.7.4\r\n')).toBe('rizin 0.7.4')
    expect(firstVersionLine('\r\n  5.9.0\r\n')).toBe('5.9.0')
  })

  it('usa stderr si stdout está vacío y no deja basura', () => {
    expect(firstVersionLine('', 'rizin 0.7.4\r\ncopyright\r\n')).toBe('rizin 0.7.4')
    expect(firstVersionLine('   \n', '')).toBe('sin versión')
  })
})
