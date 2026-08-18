'use client';

import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Alerts = {
  lowBalances: { studentName: string; studentCode: string; schoolName: string; balance: string }[];
  dailyLimitReached: { studentName: string; studentCode: string; schoolName: string; dailyLimit: string; spentToday: string }[];
  revokedCardAttempts: { at: string; schoolName: string; userEmail: string; token: string }[];
  failedLogins: { email: string; failedCount: number; lockedUntil: string | null; lastAttemptAt: string }[];
  repeatedRefunds: { userEmail: string; schoolName: string; count: number; amount: string }[];
};

function Empty() {
  return <p className="empty-state">لا توجد تنبيهات في هذه المجموعة.</p>;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alerts | null>(null);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/alerts');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل التنبيهات.');
    setAlerts(await response.json());
    setMessage('');
  };

  useEffect(() => { void load(); }, []);

  return (
    <AdminShell>
      <header><div><h1>التنبيهات الذكية</h1><span>متابعة المخاطر المالية والأمنية بشكل سريع</span></div><button onClick={() => void load()}>تحديث</button></header>
      {message && <p role="status">{message}</p>}

      <div className="alert-grid">
        <article className="alert-card warn"><h2>رصيد أقل من 10 ريال</h2>{alerts?.lowBalances.length ? alerts.lowBalances.map(item => <p key={`${item.studentCode}-${item.schoolName}`}>{item.studentName} — {item.schoolName}: <strong>{item.balance} ر.س</strong></p>) : <Empty />}</article>
        <article className="alert-card danger"><h2>وصل الحد اليومي</h2>{alerts?.dailyLimitReached.length ? alerts.dailyLimitReached.map(item => <p key={`${item.studentCode}-${item.schoolName}`}>{item.studentName} — صرف {item.spentToday} من حد {item.dailyLimit} ر.س</p>) : <Empty />}</article>
        <article className="alert-card danger"><h2>محاولة استخدام بطاقة ملغاة</h2>{alerts?.revokedCardAttempts.length ? alerts.revokedCardAttempts.map(item => <p key={`${item.at}-${item.token}`}>{new Date(item.at).toLocaleString('ar-SA')} — {item.schoolName} — {item.userEmail} — {item.token}</p>) : <Empty />}</article>
        <article className="alert-card warn"><h2>محاولات دخول فاشلة</h2>{alerts?.failedLogins.length ? alerts.failedLogins.map(item => <p key={item.email}>{item.email}: {item.failedCount} محاولات{item.lockedUntil ? ` — مقفل حتى ${new Date(item.lockedUntil).toLocaleString('ar-SA')}` : ''}</p>) : <Empty />}</article>
        <article className="alert-card warn"><h2>استرجاعات متكررة</h2>{alerts?.repeatedRefunds.length ? alerts.repeatedRefunds.map(item => <p key={`${item.userEmail}-${item.schoolName}`}>{item.userEmail} — {item.schoolName}: {item.count} استرجاعات / {item.amount} ر.س</p>) : <Empty />}</article>
      </div>
    </AdminShell>
  );
}
