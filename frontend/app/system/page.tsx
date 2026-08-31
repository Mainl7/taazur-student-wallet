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
    openErrors: number;
  };
  lockedAttempts: { email: string; failedCount: number; lockedUntil: string | null; lastAttemptAt: string }[];
  demoAccounts: { id: string; email: string; role: string; status: string; createdAt: string }[];
  officialAdmin: { email: string; role: string; status: string } | null;
  settings: {
    organizationName: string;
    lowBalanceThreshold: number;
    alertsEnabled: boolean;
    backupReminderEnabled: boolean;
    supportEmail: string;
    supportPhone: string;
    cashierRequireStudentPreview: boolean;
  };
  recentErrors: { id: string; requestId: string; method: string; path: string; statusCode: number; error: string; message?: string | null; createdAt: string; resolvedAt?: string | null }[];
  lastBackup: { timestamp: string; user?: { email: string } | null } | null;
  recommendations: string[];
};

function Check({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? 'check-pill ok' : 'check-pill warn'}>{ok ? '✓' : '!'} {label}</span>;
}

export default function SystemHealth() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SystemStatus['settings'] | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/system/status');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل صحة النظام.');
    const data: SystemStatus = await response.json();
    setStatus(data);
    setSettingsDraft(data.settings);
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

  async function saveSettings() {
    if (!settingsDraft) return;
    const response = await apiFetch('/system/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settingsDraft)
    });
    const data: { settings?: SystemStatus['settings']; error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(data.error === 'FORBIDDEN' ? 'تعديل الإعدادات للمدير العام فقط.' : 'تعذر حفظ إعدادات النظام.');
    setMessage('تم حفظ إعدادات النظام.');
    void load();
  }

  async function resolveError(errorLogId: string) {
    const response = await apiFetch(`/system/error-logs/${errorLogId}/resolve`, { method: 'POST' });
    if (!response.ok) return setMessage('تعذر تعليم الخطأ كمراجع.');
    setMessage('تم تعليم الخطأ كمراجع.');
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
            <article><small>أخطاء تحتاج مراجعة</small><b>{status.counts.openErrors}</b><span>خطأ</span></article>
          </section>

          <section className="panel system-checks">
            <h2>جاهزية الإنتاج</h2>
            <div>
              <Check ok={status.environment.cookieSecure} label="Cookie آمن HTTPS" />
              <Check ok={status.environment.officialAdminEmailConfigured && !!status.officialAdmin} label="حساب مدير رسمي" />
              <Check ok={status.environment.webOriginConfigured} label="WEB_ORIGIN مضبوط" />
              <Check ok={!status.demoAccounts.some(account => account.status === 'ACTIVE')} label="الحسابات التجريبية غير نشطة" />
              <Check ok={status.counts.openErrors === 0} label="لا توجد أخطاء مفتوحة" />
              <Check ok={!status.settings.backupReminderEnabled || !!status.lastBackup} label="يوجد أثر لنسخة احتياطية" />
            </div>
          </section>

          {settingsDraft && (
            <section className="panel">
              <h2>إعدادات التشغيل</h2>
              <div className="settings-grid">
                <label>اسم الجهة
                  <input value={settingsDraft.organizationName} onChange={event => setSettingsDraft({ ...settingsDraft, organizationName: event.target.value })} />
                </label>
                <label>تنبيه الرصيد إذا أقل من
                  <input type="number" min="0" max="500" step="0.5" value={settingsDraft.lowBalanceThreshold} onChange={event => setSettingsDraft({ ...settingsDraft, lowBalanceThreshold: Number(event.target.value) })} />
                </label>
                <label>بريد الدعم
                  <input type="email" value={settingsDraft.supportEmail} onChange={event => setSettingsDraft({ ...settingsDraft, supportEmail: event.target.value })} />
                </label>
                <label>جوال الدعم
                  <input value={settingsDraft.supportPhone} onChange={event => setSettingsDraft({ ...settingsDraft, supportPhone: event.target.value })} />
                </label>
                <label className="check-control"><input type="checkbox" checked={settingsDraft.alertsEnabled} onChange={event => setSettingsDraft({ ...settingsDraft, alertsEnabled: event.target.checked })} /> تشغيل التنبيهات الذكية</label>
                <label className="check-control"><input type="checkbox" checked={settingsDraft.backupReminderEnabled} onChange={event => setSettingsDraft({ ...settingsDraft, backupReminderEnabled: event.target.checked })} /> تذكير النسخ الاحتياطي</label>
                <label className="check-control"><input type="checkbox" checked={settingsDraft.cashierRequireStudentPreview} onChange={event => setSettingsDraft({ ...settingsDraft, cashierRequireStudentPreview: event.target.checked })} /> إلزام الكاشير بإظهار الطالب قبل الخصم</label>
              </div>
              <button type="button" onClick={() => void saveSettings()}>حفظ إعدادات النظام</button>
            </section>
          )}

          <section className="two-columns">
            <article className="panel">
              <h2>النسخ الاحتياطي</h2>
              <p>نزّل نسخة JSON للمراجعة قبل أي تعديل كبير. آخر نسخة من داخل النظام: {status.lastBackup ? `${new Date(status.lastBackup.timestamp).toLocaleString('ar-SA')} بواسطة ${status.lastBackup.user?.email ?? 'مستخدم'}` : 'لا توجد نسخة مسجلة بعد'}.</p>
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
            <h2>آخر الأخطاء</h2>
            {status.recentErrors.length ? (
              <table>
                <thead><tr><th>الوقت</th><th>الكود المرجعي</th><th>الخطأ</th><th>المسار</th><th>الحالة</th><th>الإجراء</th></tr></thead>
                <tbody>
                  {status.recentErrors.map(error => (
                    <tr key={error.id}>
                      <td>{new Date(error.createdAt).toLocaleString('ar-SA')}</td>
                      <td className="token">{error.requestId}</td>
                      <td>{error.error}</td>
                      <td className="token">{error.method} {error.path}</td>
                      <td>{error.resolvedAt ? 'تمت المراجعة' : 'مفتوح'}</td>
                      <td>{error.resolvedAt ? '—' : <button type="button" className="secondary" onClick={() => void resolveError(error.id)}>تمت المراجعة</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p>لا توجد أخطاء مسجلة.</p>}
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
