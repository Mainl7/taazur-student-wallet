export const api = '/api/v1';

export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${api}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.headers
  });
}
