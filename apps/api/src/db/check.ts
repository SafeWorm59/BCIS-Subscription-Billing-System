import { checkDatabaseConnection, closeDatabaseConnection } from './client.js'

try {
  await checkDatabaseConnection()
  console.log('Database connection successful')
} catch (error) {
  console.error(
    'Database connection failed:',
    error instanceof Error ? error.message : error
  )
  process.exitCode = 1
} finally {
  await closeDatabaseConnection()
}
