import { access } from 'node:fs/promises'
import { join } from 'node:path'

export type PostgresUtility = 'pg_dump' | 'pg_restore'

interface PostgresUtilityOptions {
  platform?: NodeJS.Platform
  programFiles?: string
  fileExists?: (path: string) => Promise<boolean>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function resolvePostgresUtility(
  utility: PostgresUtility,
  {
    platform = process.platform,
    programFiles = process.env.ProgramFiles || 'C:\\Program Files',
    fileExists = exists
  }: PostgresUtilityOptions = {}
): Promise<string> {
  const executable = platform === 'win32' ? `${utility}.exe` : utility
  if (platform === 'win32') {
    const postgresql17Executable = join(
      programFiles,
      'PostgreSQL',
      '17',
      'bin',
      executable
    )
    if (await fileExists(postgresql17Executable)) return postgresql17Executable
  }
  return executable
}
