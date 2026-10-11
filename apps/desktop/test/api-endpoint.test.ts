import { describe, expect, it } from 'vitest'
import { validateApiEndpoint } from '../src/main/api-endpoint'

describe('validateApiEndpoint', () => {
  it('accepts HTTPS endpoints and local development HTTP', () => {
    expect(validateApiEndpoint('https://billing.example.org/')).toBe('https://billing.example.org')
    expect(validateApiEndpoint('http://127.0.0.1:3001')).toBe('http://127.0.0.1:3001')
    expect(validateApiEndpoint('http://localhost:3001')).toBe('http://localhost:3001')
  })

  it.each([
    'http://billing.example.org',
    'https://user:password@billing.example.org',
    'https://billing.example.org/api/v1',
    'https://billing.example.org/?token=secret',
    'file:///etc/passwd',
    'not a URL'
  ])('rejects unsafe or malformed endpoints: %s', (endpoint) => {
    expect(() => validateApiEndpoint(endpoint)).toThrow()
  })
})
