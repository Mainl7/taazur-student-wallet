'use client';

import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type SystemStatus = {
  database: { ok: boolean; provider: string };
  environment: {
    nodeEnv: string;
    cookieSecure: boolean;
    sessionDurationHours: number;
    officialAdminEmailConfigured: boolean;
    webOriginConfigured: boolean;
  };
  counts: {
    users: number;
    schools: number;
    students: number;
    canteens: number;
    transactions: number;
    activeSessions: number;
    lockedLogins: number;
  };
  lockedAttempts: { email: string; failedCount: number; lockedUntil: string | null; lastAttemptAt: string }[];
  demoAccounts: { id: string; email: string; role: string; status: string; createdAt: string }[];
  officialAdmin: { email: string; role: string; status: string } | null;
  recommendations: string[];
};

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'check-pill ok' : 'check-pill warn'}>{ok ? '✓' : '!'} {label}</span>;
}

export default function SystemHealth() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/system/status');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل صحة النظام.');
    setStatus(await response.json());
  };

  useEffect(() => { void load(); }, []);

  async function disableDemoAccounts() {
    if (!confirm('سيتم تعطيل حسابات admin@taazur.local و operator@taazur.local إن وجدت. هل تريد المتابعة؟')) return;
    const response = await apiFetch('/system/disable-demo-accounts', { method: 'POST' });
    const data: { count?: number; error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error === 'FORBIDDEN' ? 'هذه العملية للمدير العام فقط.' : 'تعذر تعطيل الحسابات التجريبية.');
    setMessage(`تم تعطيل ${data.count ?? 0} حساب تجريبي.`);
    void load();
  }

  async function unlockLogin(email: string) {
    const response = await apiFetch('/system/unlock-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) return setMessage('تعذر فك قفل الحساب.');
    setMessage(`تم فك قفل ${email}.`);
    void load();
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>صحة النظام</h1>
          <p>فحص سريع للتجهيز قبل النشر والاعتماد.</p>
        </div>
        <button type="button" onClick={() => void load()}>تحديث</button>
      </header>

      {message && <p role="status">{message}</p>}

      {status && (
        <>
          <section className="cards">
            <article><small>قاعدة البيانات</small><b>{status.database.ok ? 'متصلة' : 'غير متصلة'}</b><span>{status.database.provider}</span></article>
            <article><small>الجلسات النشطة</small><b>{status.counts.activeSessions}</b><span>جلسة</span></article>
            <article><small>محاولات دخول مقفلة</small><b>{status.counts.lockedLogins}</b><span>حساب</span></article>
            <article><small>العمليات</small><b>{status.counts.transactions}</b><span>عملية محفوظة</span></article>
          </section>

          <section className="panel system-checks">
            <h2>جاهزية الإنتاج</h2>
            <div>
              <Check ok={status.environment.cookieSecure} label="Cookie آمن HTTPS" />
              <Check ok={status.environment.officialAdminEmailConfigured && !!status.officialAdmin} label="حساب مدير رسمي" />
              <Check ok={status.environment.webOriginConfigured} label="WEB_ORIGIN مضبوط" />
              <Check ok={!status.demoAccounts.some(account => account.status === 'ACTIVE')} label="الحسابات التجريبية غير نشطة" />
            </div>
          </section>

          <section className="two-columns">
            <article className="panel">
              <h2>النسخ الاحتياطي</h2>
              <p>نزّل نسخة JSON للمراجعة قبل أي تعديل كبير. وفي صحارى نت فعّل نسخة MySQL يومية من لوحة الاستضافة.</p>
              <a className="button-link" href="/api/v1/system/backup.json">تنزيل نسخة JSON</a>
            </article>

            <article className="panel">
              <h2>الحسابات التجريبية</h2>
              {status.demoAccounts.length ? (
                <ul>
                  {status.demoAccounts.map(account => <li key={account.id}>{account.email} — {account.status}</li>)}
                </ul>
              ) : <p>لا توجد حسابات تجريبية.</p>}
              <button type="button" className="danger-button" onClick={() => void disableDemoAccounts()}>تعطيل الحسابات التجريبية</button>
            </article>
          </section>

          <section className="panel">
            <h2>محاولات الدخول المقفلة</h2>
            {status.lockedAttempts.length ? (
              <table>
                <thead><tr><th>البريد</th><th>عدد المحاولات</th><th>مقفل حتى</th><th>الإجراء</th></tr></thead>
                <tbody>
                  {status.lockedAttempts.map(attempt => (
                    <tr key={attempt.email}>
                      <td>{attempt.email}</td>
                      <td>{attempt.failedCount}</td>
                      <td>{attempt.lockedUntil ? new Date(attempt.lockedUntil).toLocaleString('ar-SA') : '—'}</td>
                      <td><button type="button" className="secondary" onClick={() => void unlockLogin(attempt.email)}>فك القفل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>لا توجد حسابات مقفلة حاليًا.</p>}
          </section>

          <section className="panel">
            <h2>أرقام النظام</h2>
            <div className="system-numbers">
              <span>المستخدمون: <b>{status.counts.users}</b></span>
              <span>المدارس: <b>{status.counts.schools}</b></span>
              <span>الطلاب: <b>{status.counts.students}</b></span>
              <span>المقاصف: <b>{status.counts.canteens}</b></span>
            </div>
          </section>

          <section className="panel">
            <h2>توصيات التشغيل</h2>
            <ul>{status.recommendations.map(item => <li key={item}>{item}</li>)}</ul>
          </section>
        </>
      )}
    </AdminShell>
  );
}
