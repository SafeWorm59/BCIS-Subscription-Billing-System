import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { isAbsolute, resolve } from 'node:path'
import { env } from '../config/env.js'
import { resolvePostgresUtility } from './postgres-tool.js'

const archiveArg = process.argv[2]
if (!archiveArg || !isAbsolute(archiveArg)) {
  throw new Error('Usage: npm run db:restore -- <absolute-path-to-backup.dump>')
}
const archive = resolve(archiveArg)
await access(archive)
const pgRestore = await resolvePostgresUtility('pg_restore')
const databaseUrl = new URL(env.DATABASE_URL)
const databaseName = decodeURIComponent(databaseUrl.pathname.slice(1))
const postgresEnv: NodeJS.ProcessEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'DATABASE_URL')
  ),
  PGHOST: databaseUrl.hostname,
  PGPORT: databaseUrl.port || '5432',
  PGUSER: decodeURIComponent(databaseUrl.username),
  PGPASSWORD: decodeURIComponent(databaseUrl.password),
  PGDATABASE: databaseName,
  PGSSLMODE: databaseUrl.searchParams.get('sslmode') ?? process.env['PGSSLMODE']
}
const preflight = spawn(pgRestore, ['--list', archive], {
  env: postgresEnv,
  stdio: 'ignore',
  windowsHide: true
})
if (
  await new Promise<boolean>((resolvePromise) => {
    preflight.once('error', () => resolvePromise(false))
    preflight.once('close', (code) => resolvePromise(code === 0))
  })
) {
  const prompt = createInterface({ input: stdin, output: stdout })
  try {
    console.error(
      `WARNING: restore will replace objects in database "${databaseName}". This action cannot be undone.`
    )
    const confirmation = await prompt.question(
      `Type the database name exactly to continue (${databaseName}): `
    )
    if (confirmation !== databaseName)
      throw new Error('Restore cancelled; database name did not match.')
  } finally {
    prompt.close()
  }
} else {
  throw new Error(
    'Backup archive preflight failed or pg_restore is unavailable.'
  )
}
const child = spawn(
  pgRestore,
  [
    '--clean',
    '--if-exists',
    '--exit-on-error',
    '--single-transaction',
    '--no-owner',
    '--no-acl',
    '--dbname',
    databaseName,
    archive
  ],
  {
    env: postgresEnv,
    stdio: 'ignore',
    windowsHide: true
  }
)
const result = await new Promise<number>((resolvePromise, reject) => {
  child.once('error', () =>
    reject(
      new Error(
        'Could not start pg_restore; install PostgreSQL 17 command line tools.'
      )
    )
  )
  child.once('close', (code) => resolvePromise(code ?? 1))
})
if (result !== 0)
  throw new Error(
    `Restore failed with exit code ${result}; diagnostic output withheld.`
  )
console.log(`Restore completed for database "${databaseName}".`)
