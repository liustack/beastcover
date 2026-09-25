import { describe, expect, it, vi } from 'vitest'
import { DIMENSION_PRESET_NAMES } from '../src/dimensions.ts'
import { apply, inject, name } from './index.js'

describe('dsh plugin', () => {
  it('registers a BeastCover generation tool backed by the bundled CLI', () => {
    const register = vi.fn()

    apply({ tools: { register } })

    expect(name).toBe('beastcover')
    expect(inject).toEqual(['tools'])
    expect(register).toHaveBeenCalledOnce()
    expect(register.mock.calls[0]?.[0]).toMatchObject({
      name: 'beastcover_generate_image',
      parameters: {
        required: ['text'],
      },
    })
  })

  it('offers exactly the CLI platform presets', () => {
    const register = vi.fn()
    apply({ tools: { register } })

    expect(register.mock.calls[0]?.[0].parameters.properties.preset.enum).toEqual([...DIMENSION_PRESET_NAMES])
  })
})
