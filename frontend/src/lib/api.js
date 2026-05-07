/**
 * API Helper — Authenticated fetch wrapper for backend calls.
 *
 * Automatically attaches the user's JWT token to requests.
 * Handles 401 responses by triggering re-authentication.
 */
import { getAccessToken } from './supabase'

const API_URL = import.meta.env.VITE_API_URL || 'https://backend-delta-ivory-13.vercel.app'

/**
 * Make an authenticated API request.
 *
 * @param {string} endpoint - API path (e.g., '/api/profile')
 * @param {object} options - Fetch options (method, body, etc.)
 * @returns {Promise<any>} - Parsed JSON response
 */
export async function apiRequest(endpoint, options = {}) {
  const token = await getAccessToken()

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`

  const res = await fetch(url, {
    ...options,
    headers,
  })

  if (res.status === 401) {
    // Token expired or invalid — trigger re-auth
    window.dispatchEvent(new CustomEvent('auth:expired'))
    throw new Error('Authentication expired. Please sign in again.')
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(error.detail || `API error: ${res.status}`)
  }

  return res.json()
}

/**
 * Authenticated fetch that returns the raw Response object.
 * Unlike apiRequest, this does NOT auto-parse JSON — caller handles res.json().
 *
 * @param {string} endpoint - API path or full URL
 * @param {object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Response>} - Raw fetch Response
 */
export async function authenticatedFetch(endpoint, options = {}) {
  const token = await getAccessToken()

  const headers = {
    'Accept': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  // Only set Content-Type if body is not FormData
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_URL}${endpoint}`

  return fetch(url, {
    ...options,
    headers,
  })
}

/**
 * Convenience methods for common HTTP verbs.
 */
export const api = {
  get: (endpoint, params) => {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params).toString()}`
      : endpoint
    return apiRequest(url)
  },

  post: (endpoint, body) =>
    apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  put: (endpoint, body) =>
    apiRequest(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  delete: (endpoint) =>
    apiRequest(endpoint, {
      method: 'DELETE',
    }),
}

export default api
