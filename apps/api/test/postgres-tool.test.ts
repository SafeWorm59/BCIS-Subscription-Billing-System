import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { resolvePostgresUtility } from '../src/db/postgres-tool.js'

describe('PostgreSQL utility resolution', () => {
  it('prefers the installed PostgreSQL 17 Windows utility', async () => {
    const expectedPath = join(
      'C:\\Program Files',
      'PostgreSQL',
      '17',
      'bin',
      'pg_dump.exe'
    )
    const fileExists = vi.fn(async (path: string) => path === expectedPath)

    await expect(
      resolvePostgresUtility('pg_dump', {
        platform: 'win32',
        programFiles: 'C:\\Program Files',
        fileExists
      })
    ).resolves.toBe(expectedPath)
    expect(fileExists).toHaveBeenCalledOnce()
  })

  it('falls back to PATH when the standard PostgreSQL 17 location is absent', async () => {
    await expect(
      resolvePostgresUtility('pg_restore', {
        platform: 'win32',
        fileExists: async () => false
      })
    ).resolves.toBe('pg_restore.exe')
  })

  it('uses the command name on non-Windows platforms', async () => {
    await expect(
      resolvePostgresUtility('pg_dump', { platform: 'linux' })
    ).resolves.toBe('pg_dump')
  })
})
