'use client';

import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Summary = {
  canteenUser: { id: string; email: string; school?: { name: string; schoolCode: string } | null };
  canteen?: { id: string; name: string; canteenCode?: string | null; schoolId: string; school: { name: string; schoolCode: string } } | null;
  periodStart: string;
  debit: string;
  refund: string;
  net: string;
  transactionCount: number;
};
type Settlement = {
  id: string;
  amount: string;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  canteen?: { name: string; canteenCode?: string | null } | null;
  canteenUser: { email: string };
  settledBy: { email: string };
  school?: { name: string } | null;
};

export default function CanteenSettlementsPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/canteen/settlements');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل تسويات المقصف.');
    const data: { summaries?: Summary[]; settlements?: Settlement[] } = await response.json();
    setSummaries(Array.isArray(data.summaries) ? data.summaries : []);
    setSettlements(Array.isArray(data.settlements) ? data.settlements : []);
    setMessage('');
  };

  useEffect(() => { void load(); }, []);

  async function settle(summary: Summary) {
    const label = summary.canteen ? `${summary.canteen.name} (${summary.canteen.school.name})` : summary.canteenUser.email;
    if (!confirm(`تأكيد سداد ${label} بمبلغ ${summary.net} ر.س؟ بعد التأكيد سيعود المستحق الحالي إلى صفر.`)) return;

    const response = await apiFetch('/canteen/settlements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(summary.canteen ? { canteenId: summary.canteen.id } : { canteenUserId: summary.canteenUser.id }), note: 'تم السداد من لوحة الإدارة' })
    });
    const data: { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر تسجيل التسوية: ${data.error ?? 'UNKNOWN_ERROR'}`);
    setMessage('تم تسجيل السداد وإعادة مستحق المقصف إلى صفر.');
    void load();
  }

  return (
    <AdminShell>
      <header><div><h1>تسوية المقصف</h1><span>مجموع الخصومات المستحقة لكل مقصف بعد خصم الاسترجاعات</span></div><button onClick={() => void load()}>تحديث</button></header>
      {message && <p role="status">{message}</p>}
      <div className="report-grid">
        {summaries.map(summary => (
          <article className="metric-card settlement-card" key={summary.canteen?.id ?? summary.canteenUser.id}>
            <small>{summary.canteen?.school.name ?? summary.canteenUser.school?.name ?? 'بدون مدرسة'}</small>
            <h3>{summary.canteen?.name ?? summary.canteenUser.email}</h3>
            {summary.canteen && <p>المشغّل: {summary.canteenUser.email}</p>}
            <b>{summary.net} ر.س</b>
            <p>خصومات: {summary.debit} ر.س — استرجاع: {summary.refund} ر.س — عدد الخصومات: {summary.transactionCount}</p>
            {summary.canteen && <a className="table-link" href={`/canteens/${summary.canteen.id}`}>تفاصيل المقصف</a>}
            <button onClick={() => void settle(summary)} disabled={Number(summary.net) <= 0}>تم سداد المقصف</button>
          </article>
        ))}
      </div>
      <h2>سجل التسويات</h2>
      <table><thead><tr><th>التاريخ</th><th>المقصف</th><th>المشغّل</th><th>المدرسة</th><th>الفترة</th><th>عدد العمليات</th><th>المبلغ</th><th>سجلها</th></tr></thead><tbody>{settlements.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('ar-SA')}</td><td>{item.canteen?.name ?? 'مقصف قديم'}</td><td>{item.canteenUser.email}</td><td>{item.school?.name ?? '—'}</td><td>{new Date(item.periodStart).toLocaleDateString('ar-SA')} - {new Date(item.periodEnd).toLocaleDateString('ar-SA')}</td><td>{item.transactionCount}</td><td>{item.amount} ر.س</td><td>{item.settledBy.email}</td></tr>)}</tbody></table>
    </AdminShell>
  );
}
