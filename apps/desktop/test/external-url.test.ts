import { describe, expect, it } from 'vitest'
import { isApprovedExternalUrl } from '../src/main/external-url'

describe('isApprovedExternalUrl', () => {
  it.each(['https://example.com', 'http://example.com'])('allows approved web URL %s', (url) => {
    expect(isApprovedExternalUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,example',
    'ftp://example.com',
    'https://',
    '/relative/path'
  ])('rejects unapproved or invalid URL %s', (url) => {
    expect(isApprovedExternalUrl(url)).toBe(false)
  })
})
