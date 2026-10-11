import { describe, expect, it } from 'vitest'
import { csvField } from '../src/renderer/src/lib/csv'

describe('CSV field encoding', () => {
  it('quotes values and doubles embedded quotes', () => {
    expect(csvField('Cable "Plus"')).toBe('"Cable ""Plus"""')
  })

  it.each(['=1+1', '+SUM(A1:A2)', '-1+2', '@SUM(A1:A2)', ' \t=1+1'])(
    'neutralizes spreadsheet formulas beginning with %s',
    (value) => {
      expect(csvField(value)).toBe(`"'${value}"`)
    }
  )

  it('leaves ordinary money values unchanged', () => {
    expect(csvField('1500.00')).toBe('"1500.00"')
  })
})
