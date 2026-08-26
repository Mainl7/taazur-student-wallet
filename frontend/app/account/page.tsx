'use client';

import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Session = {
  id: string;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  current: boolean;
};

const passwordErrors: Record<string, string> = {
  INVALID_CREDENTIALS: 'كلمة المرور الحالية غير صحيحة.',
  PASSWORD_UNCHANGED: 'كلمة المرور الجديدة يجب أن تكون مختلفة.',
  VALIDATION_ERROR: 'كلمة المرور الجديدة يجب أن تكون 16 حرفًا على الأقل.'
};

function deviceName(userAgent?: string | null) {
  if (!userAgent) return 'جهاز غير معروف';
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone / iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/Macintosh/i.test(userAgent)) return 'Mac';
  return userAgent.slice(0, 70);
}

export default function AccountSecurity() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/auth/sessions');
    if (response.status === 401) return location.assign('/login');
    const data: { sessions: Session[] } = await response.json();
    setSessions(data.sessions);
  };

  useEffect(() => { void load(); }, []);

  async function changePassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage('');
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (data.newPassword !== data.confirmPassword) return setMessage('تأكيد كلمة المرور غير مطابق.');
    const response = await apiFetch('/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: data.currentPassword, newPassword: data.newPassword })
    });
    const result: { error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(passwordErrors[result.error ?? ''] ?? 'تعذر تغيير كلمة المرور.');
    form.reset();
    setMessage('تم تغيير كلمة المرور وإغلاق الجلسات الأخرى.');
    void load();
  }

  async function revokeSession(session: Session) {
    const response = await apiFetch(`/auth/sessions/${session.id}`, { method: 'DELETE' });
    if (!response.ok) return setMessage('تعذر إنهاء الجلسة.');
    if (session.current) return location.assign('/login');
    setMessage('تم إنهاء الجلسة.');
    void load();
  }

  async function logoutAll() {
    if (!confirm('سيتم تسجيل خروج كل الأجهزة بما فيها جهازك الحالي. هل أنت متأكد؟')) return;
    await apiFetch('/auth/logout-all', { method: 'POST' });
    location.assign('/login');
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>الحساب والأمان</h1>
          <p>إدارة كلمة المرور والجلسات النشطة لحسابك.</p>
        </div>
      </header>

      <section className="two-columns">
        <form className="panel security-form" onSubmit={changePassword}>
          <h2>تغيير كلمة المرور</h2>
          <label>كلمة المرور الحالية<input name="currentPassword" type="password" minLength={12} required autoComplete="current-password" /></label>
          <label>كلمة المرور الجديدة<input name="newPassword" type="password" minLength={16} required autoComplete="new-password" /></label>
          <label>تأكيد كلمة المرور<input name="confirmPassword" type="password" minLength={16} required autoComplete="new-password" /></label>
          <button>حفظ كلمة المرور</button>
          {message && <p role="status">{message}</p>}
        </form>

        <article className="panel">
          <h2>نصيحة أمان</h2>
          <p>استخدم كلمة مرور طويلة وفريدة. عند تغييرها سيتم إغلاق بقية الأجهزة تلقائيًا لتقليل المخاطر.</p>
          <button type="button" className="danger-button" onClick={() => void logoutAll()}>تسجيل خروج من كل الأجهزة</button>
        </article>
      </section>

      <h2>الجلسات النشطة</h2>
      <table>
        <thead><tr><th>الجهاز</th><th>IP</th><th>آخر نشاط</th><th>تنتهي</th><th>الحالة</th><th>الإجراء</th></tr></thead>
        <tbody>
          {sessions.map(session => (
            <tr key={session.id}>
              <td>{deviceName(session.userAgent)}{session.current ? ' — هذا الجهاز' : ''}</td>
              <td>{session.ip ?? '—'}</td>
              <td>{new Date(session.lastSeenAt).toLocaleString('ar-SA')}</td>
              <td>{new Date(session.expiresAt).toLocaleString('ar-SA')}</td>
              <td>{session.revokedAt ? 'منتهية' : 'نشطة'}</td>
              <td><button type="button" className="secondary" onClick={() => void revokeSession(session)}>إنهاء</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>
  );
}
