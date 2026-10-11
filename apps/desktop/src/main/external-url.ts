const APPROVED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

export function isApprovedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return APPROVED_EXTERNAL_PROTOCOLS.has(url.protocol) && url.hostname.length > 0
  } catch {
    return false
  }
}
