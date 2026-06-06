import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const backendRoot = path.resolve(__dirname, '..')

function parseSqlitePath(value) {
  if (!value) return path.join(backendRoot, 'data', 'quizhub.db')
  if (value.startsWith('sqlite:///')) {
    const raw = value.replace('sqlite:///', '')
    return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw)
  }
  return path.isAbsolute(value) ? value : path.resolve(backendRoot, value)
}

const databaseFile = parseSqlitePath(process.env.DATABASE_URL || process.env.DATABASE_FILE)
fs.mkdirSync(path.dirname(databaseFile), { recursive: true })

function parseCorsOrigins(value) {
  if (!value) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:8080', 'http://127.0.0.1:8080']
  }

  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }

  return []
}

export const config = {
  appName: process.env.APP_NAME || 'QuizHub MVP',
  port: Number(process.env.PORT || 8000),
  databaseFile,
  jwtSecret: process.env.SECRET_KEY || process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS),
}
