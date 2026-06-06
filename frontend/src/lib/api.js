const API_BASE = import.meta.env.VITE_API_URL || ''

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(url, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'string' ? payload : payload.detail || 'Не удалось выполнить запрос'
    throw new Error(message)
  }

  return payload
}

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const api = {
  base: API_BASE,
  request,
  authHeader,
}
