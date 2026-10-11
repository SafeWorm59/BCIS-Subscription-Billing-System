import { buildApp } from './app.js'
import { env } from './config/env.js'

const app = buildApp()

async function shutdown(): Promise<void> {
  await app.close()
}

process.once('SIGINT', () => {
  void shutdown()
})

process.once('SIGTERM', () => {
  void shutdown()
})

try {
  const address = await app.listen({ host: env.API_HOST, port: env.API_PORT })
  app.log.info({ address }, 'BCIS API is listening')
} catch (error) {
  app.log.error({ err: error }, 'Unable to start BCIS API')
  await app.close()
  process.exitCode = 1
}
