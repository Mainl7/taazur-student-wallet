'use client';

import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type AlertItem = {
  id: string;
  type: string;
  severity: 'danger' | 'warn' | 'info';
  title: string;
  description: string;
  metric: string | number;
  href: string;
  createdAt: string;
};
type Alerts = {
  summary?: {
    total: number;
    danger: number;
    warn: number;
    lowBalances: number;
    dailyLimitReached: number;
    revokedCardAttempts: number;
    failedLogins: number;
    repeatedRefunds: number;
  };
  items?: AlertItem[];
  lowBalances: { studentId?: string; studentName: string; studentCode: string; schoolName: string; balance: string }[];
  dailyLimitReached: { studentId?: string; studentName: string; studentCode: string; schoolName: string; dailyLimit: string; spentToday: string }[];
  revokedCardAttempts: { at: string; schoolName: string; userEmail: string; token: string }[];
  failedLogins: { email: string; failedCount: number; lockedUntil: string | null; lastAttemptAt: string }[];
  repeatedRefunds: { userEmail: string; schoolName: string; count: number; amount: string }[];
};

function Empty() {
  return <p className="empty-state">لا توجد تنبيهات في هذه المجموعة.</p>;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [reviewedIds, setReviewedIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/alerts');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل التنبيهات.');
    setAlerts(await response.json());
    setMessage('');
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    setReviewedIds(JSON.parse(localStorage.getItem('taazur_reviewed_alerts') ?? '[]'));
  }, []);

  function markReviewed(id: string) {
    const next = [...new Set([...reviewedIds, id])];
    setReviewedIds(next);
    localStorage.setItem('taazur_reviewed_alerts', JSON.stringify(next));
  }

  const activeItems = alerts?.items?.filter(item => !reviewedIds.includes(item.id)) ?? [];

  return (
    <AdminShell>
      <header><div><h1>التنبيهات الذكية</h1><span>متابعة المخاطر المالية والأمنية بشكل سريع</span></div><button onClick={() => void load()}>تحديث</button></header>
      {message && <p role="status">{message}</p>}

      <div className="cards alert-summary">
        <article><small>إجمالي التنبيهات</small><b>{alerts?.summary?.total ?? 0}</b></article>
        <article><small>عالية الخطورة</small><b>{alerts?.summary?.danger ?? 0}</b></article>
        <article><small>تحتاج متابعة</small><b>{alerts?.summary?.warn ?? 0}</b></article>
        <article><small>آخر تحديث</small><b>{new Date().toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}</b></article>
      </div>

      <section className="dashboard-section">
        <div className="section-title">
          <h2>الأولوية الآن</h2>
          <span>مرتبة حسب الخطورة ثم الأحدث</span>
        </div>
        <div className="alert-timeline">
          {activeItems.length ? activeItems.map(item => (
            <div className={`alert-row ${item.severity}`} key={item.id}>
              <span className="alert-badge">{item.severity === 'danger' ? 'عاجل' : item.severity === 'warn' ? 'تنبيه' : 'معلومة'}</span>
              <span>
                <a href={item.href}><strong>{item.title}</strong></a>
                <small>{item.description}</small>
              </span>
              <b>{item.metric}</b>
              <button type="button" className="secondary" onClick={() => markReviewed(item.id)}>تمت المراجعة</button>
            </div>
          )) : <p className="empty-state">لا توجد تنبيهات تحتاج إجراء الآن.</p>}
        </div>
      </section>

      <div className="alert-grid">
        <article className="alert-card warn"><h2>رصيد فسحة أقل من 10 ريال</h2>{alerts?.lowBalances.length ? alerts.lowBalances.map(item => <p key={`${item.studentCode}-${item.schoolName}`}>{item.studentName} — {item.schoolName}: <strong>{item.balance} ر.س</strong></p>) : <Empty />}</article>
        <article className="alert-card danger"><h2>وصل الحد اليومي</h2>{alerts?.dailyLimitReached.length ? alerts.dailyLimitReached.map(item => <p key={`${item.studentCode}-${item.schoolName}`}>{item.studentName} — صرف {item.spentToday} من حد {item.dailyLimit} ر.س</p>) : <Empty />}</article>
        <article className="alert-card danger"><h2>محاولة استخدام بطاقة ملغاة</h2>{alerts?.revokedCardAttempts.length ? alerts.revokedCardAttempts.map(item => <p key={`${item.at}-${item.token}`}>{new Date(item.at).toLocaleString('ar-SA')} — {item.schoolName} — {item.userEmail} — {item.token}</p>) : <Empty />}</article>
        <article className="alert-card warn"><h2>محاولات دخول فاشلة</h2>{alerts?.failedLogins.length ? alerts.failedLogins.map(item => <p key={item.email}>{item.email}: {item.failedCount} محاولات{item.lockedUntil ? ` — مقفل حتى ${new Date(item.lockedUntil).toLocaleString('ar-SA')}` : ''}</p>) : <Empty />}</article>
        <article className="alert-card warn"><h2>استرجاعات متكررة</h2>{alerts?.repeatedRefunds.length ? alerts.repeatedRefunds.map(item => <p key={`${item.userEmail}-${item.schoolName}`}>{item.userEmail} — {item.schoolName}: {item.count} استرجاعات / {item.amount} ر.س</p>) : <Empty />}</article>
      </div>
    </AdminShell>
  );
}
