'use client';

import { apiFetch } from '../lib/api';

export default function LogoutButton() {
  async function logout() {
    await apiFetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
    localStorage.removeItem('taazur_token');
    location.assign('/login');
  }

  return <button type="button" className="nav-button" onClick={() => void logout()}>تسجيل الخروج</button>;
}
