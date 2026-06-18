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

function parseCookies(header = '') {
  return Object.fromEntries(
    String(header)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf('=')
        if (separator < 0) return [part, '']
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))]
      }),
  )
}

export function getRequestToken(req) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  return parseCookies(req.headers.cookie)[config.cookieName] || ''
}

export function requireAuth(req, res, next) {
  const token = getRequestToken(req)
  const user = getUserFromToken(token)
  if (!user) {
    return res.status(401).json({ detail: 'Требуется авторизация' })
  }
  req.user = user
  return next()
}

export function setSessionCookie(res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearSessionCookie(res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  })
}

export function requireOrganizer(req, res, next) {
  if (req.user?.role !== 'organizer') {
    return res.status(403).json({ detail: 'Действие доступно только организатору' })
  }
  return next()
}
