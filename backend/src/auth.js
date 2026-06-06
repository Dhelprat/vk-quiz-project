import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

import { config } from './config.js'
import { db } from './db.js'

export function serializeUser(row) {
  if (!row) return null
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
  }
}

export function createToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  })
}

export function hashPassword(password) {
  return bcrypt.hashSync(password, 10)
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compareSync(password, passwordHash)
}

export function getUserFromToken(token) {
  if (!token) return null
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const userId = Number(payload.sub)
    if (!Number.isFinite(userId)) return null
    return db.prepare('SELECT * FROM users WHERE id = ?').get(userId) || null
  } catch {
    return null
  }
}

export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const user = getUserFromToken(token)
  if (!user) {
    return res.status(401).json({ detail: 'Требуется авторизация' })
  }
  req.user = user
  return next()
}

export function requireOrganizer(req, res, next) {
  if (req.user?.role !== 'organizer') {
    return res.status(403).json({ detail: 'Действие доступно только организатору' })
  }
  return next()
}
