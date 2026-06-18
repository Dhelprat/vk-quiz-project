const API_BASE = import.meta.env.VITE_API_URL || ''

async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
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

async function upload(path, formData) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.detail || 'Не удалось загрузить файл')
  return payload
}

function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const api = {
  base: API_BASE,
  request,
  upload,
  authHeader,
}
