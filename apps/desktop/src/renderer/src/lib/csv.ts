export function csvField(value: string): string {
  const spreadsheetSafeValue = /^[\s\uFEFF]*[=+\-@]/u.test(value) ? `'${value}` : value
  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`
}
