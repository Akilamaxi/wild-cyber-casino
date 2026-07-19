// Same-origin works for the production gateway and the Vite development proxy.
// Set VITE_API_BASE_URL only when the API is intentionally hosted elsewhere.
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

export function apiFetch(input, init = {}) {
  const headers = new Headers(init.headers || {});
  const csrf = document.cookie.split('; ').find(value => value.startsWith('casino_csrf='))?.split('=')[1];
  if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes((init.method || 'GET').toUpperCase())) {
    headers.set('X-CSRF-Token', decodeURIComponent(csrf));
  }
  return window.fetch(input, { ...init, headers, credentials: 'include' }).then(async response => {
    if (response.status !== 401 || String(input).includes('/auth/')) return response;
    const refreshHeaders = new Headers();
    if (csrf) refreshHeaders.set('X-CSRF-Token', decodeURIComponent(csrf));
    const refreshed = await window.fetch(`${API_BASE}/api/v1/auth/refresh`, { method: 'POST', headers: refreshHeaders, credentials: 'include' });
    return refreshed.ok ? window.fetch(input, { ...init, headers, credentials: 'include' }) : response;
  });
}
