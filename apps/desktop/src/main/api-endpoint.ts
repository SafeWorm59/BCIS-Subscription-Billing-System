export function validateApiEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 512)
    throw new Error('Enter a valid API endpoint.')
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid API endpoint URL.')
  }
  const localHttp =
    parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  if (
    (!localHttp && parsed.protocol !== 'https:') ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  )
    throw new Error(
      'Use an HTTPS base URL (or HTTP on this computer) without credentials, paths, query, or fragments.'
    )
  return parsed.origin
}
