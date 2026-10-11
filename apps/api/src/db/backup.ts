import { spawn } from 'node:child_process'
import { mkdir, open, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { env } from '../config/env.js'
import { resolvePostgresUtility } from './postgres-tool.js'

function postgresEnvironment(): NodeJS.ProcessEnv {
  const url = new URL(env.DATABASE_URL)
  const childEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key !== 'DATABASE_URL')
  )
  return {
    ...childEnvironment,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGSSLMODE: url.searchParams.get('sslmode') ?? process.env['PGSSLMODE']
  }
}

function run(
  command: string,
  args: string[],
  envVars: NodeJS.ProcessEnv
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: envVars,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true
    })
    child.once('error', () =>
      reject(
        new Error(
          `Could not start ${command}. Install PostgreSQL 17 command line tools and ensure ${command} is on PATH.`
        )
      )
    )
    child.once('close', (code) =>
      code === 0
        ? resolvePromise()
        : reject(
            new Error(
              `${command} failed with exit code ${code ?? 'unknown'}; diagnostic output withheld.`
            )
          )
    )
  })
}

const root = resolve(process.cwd(), '../..')
const backupDirectory = resolve(
  process.env['BCIS_BACKUP_DIR'] ||
    join(
      process.env['LOCALAPPDATA'] || join(homedir(), '.local', 'share'),
      'BCIS',
      'backups'
    )
)
const relativeToRoot = relative(root, backupDirectory)
if (
  !isAbsolute(backupDirectory) ||
  relativeToRoot === '' ||
  (!relativeToRoot.startsWith(`..${sep}`) && relativeToRoot !== '..')
) {
  throw new Error('Backup directory must be outside the project directory.')
}
await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, '')
  .replace(/\.(\d{3})Z$/, '-$1Z')
const output = join(backupDirectory, `bcis-${stamp}.dump`)
const outputFile = await open(output, 'wx', 0o600)
await outputFile.close()
try {
  await run(
    await resolvePostgresUtility('pg_dump'),
    ['--format=custom', '--no-owner', '--no-acl', '--file', output],
    postgresEnvironment()
  )
  await run(
    await resolvePostgresUtility('pg_restore'),
    ['--list', output],
    postgresEnvironment()
  )
} catch (error) {
  await rm(output, { force: true })
  throw error
}
console.log(`Backup created and archive listing verified: ${output}`)
