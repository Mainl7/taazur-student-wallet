'use client';

import { useEffect, useState } from 'react';
import AdminShell from './components/AdminShell';
import { apiFetch } from './lib/api';

type Dashboard = { schools: number; students: number; walletBalance: string; todayTransactions: number; todaySpent: string; revokedCards: number };

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      const response = await apiFetch('/dashboard');
      if (response.status === 401) return location.assign('/login');
      if (!response.ok) return setMessage('تتطلب لوحة الإدارة حساب مدير أو مدقق.');
      setData(await response.json());
    };
    void load();
  }, []);

  const stats = data ? [
    ['المدارس', data.schools],
    ['الطلاب النشطون', data.students],
    ['إجمالي الرصيد', `${data.walletBalance} ر.س`],
    ['عمليات اليوم', data.todayTransactions],
    ['مصروف اليوم', `${data.todaySpent} ر.س`],
    ['البطاقات الملغاة', data.revokedCards]
  ] : [];

  return (
    <AdminShell>
      <header><div><strong>لوحة إدارة المصروف المدرسي</strong><span> متابعة حيّة للمحافظ والبطاقات وعمليات المقصف</span></div></header>
      <h2>نظرة عامة</h2>
      {message && <p role="status">{message}</p>}
      <div className="cards">{stats.map(([label, value]) => <article key={String(label)}><small>{label}</small><b>{value}</b></article>)}</div>
      <div className="panel">
        <h3>إجراءات سريعة</h3>
        <p>ابدأ من أكثر المهام استخدامًا: إدارة الطلاب، متابعة العمليات، أو مراجعة سجل التدقيق.</p>
        <a href="/students">إدارة الطلاب ←</a> <a href="/wallets">شحن المحافظ ←</a> <a href="/transactions">سجل العمليات ←</a> <a href="/audit-logs">سجل التدقيق ←</a>
      </div>
    </AdminShell>
  );
}
