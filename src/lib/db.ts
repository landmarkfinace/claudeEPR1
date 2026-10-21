import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Query logging only in development (set PRISMA_LOG_QUERIES=1 to force it).
// In production every query was being written to server.log, which grows fast.
const logQueries =
  process.env.NODE_ENV !== 'production' || process.env.PRISMA_LOG_QUERIES === '1'

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: logQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
