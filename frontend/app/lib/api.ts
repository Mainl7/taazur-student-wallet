export const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export function apiFetch(path: string, init: RequestInit = {}) {
  return fetch(`${api}${path}`, {
    ...init,
    credentials: 'include',
    headers: init.headers
  });
}
