'use client';

import { useEffect, useMemo, useState } from 'react';
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
  note?: string | null;
  canteen?: { name: string; canteenCode?: string | null } | null;
  canteenUser: { email: string };
  settledBy: { email: string };
  school?: { name: string } | null;
};

export default function CanteenSettlementsPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [message, setMessage] = useState('');
  const visibleSettlements = useMemo(() => settlements.filter(item => {
    const date = item.createdAt.slice(0, 10);
    return (!startDate || date >= startDate) && (!endDate || date <= endDate);
  }), [endDate, settlements, startDate]);

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
    const receiptNumber = prompt('رقم الحوالة/الإيصال (اختياري):')?.trim() ?? '';
    const note = prompt('ملاحظة التسوية (اختياري):')?.trim() ?? '';

    const response = await apiFetch('/canteen/settlements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(summary.canteen ? { canteenId: summary.canteen.id } : { canteenUserId: summary.canteenUser.id }), receiptNumber, note: note || 'تم السداد من لوحة الإدارة' })
    });
    const data: { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر تسجيل التسوية: ${data.error ?? 'UNKNOWN_ERROR'}`);
    setMessage('تم تسجيل السداد وإعادة مستحق المقصف إلى صفر.');
    void load();
  }

  return (
    <AdminShell>
      <header><div><h1>تسوية المقصف</h1><span>مستحقات المقاصف على الجمعية بعد خصم الاسترجاعات</span></div><div className="row-actions"><button onClick={() => void load()}>تحديث</button><button type="button" className="secondary" onClick={() => print()}>إنشاء تقرير PDF</button><a href="/api/v1/exports/canteen-accounting.csv">تقرير مطابقة CSV</a></div></header>
      {message && <p role="status">{message}</p>}
      <div className="report-grid">
        {summaries.map(summary => (
          <article className="metric-card settlement-card" key={summary.canteen?.id ?? summary.canteenUser.id}>
            <small>{summary.canteen?.school.name ?? summary.canteenUser.school?.name ?? 'بدون مدرسة'}</small>
            <h3>{summary.canteen?.name ?? summary.canteenUser.email}</h3>
            {summary.canteen && <p>المشغّل: {summary.canteenUser.email}</p>}
            <b>{summary.net} ر.س</b>
            <p>مصروفات فسحة: {summary.debit} ر.س — استرجاع: {summary.refund} ر.س — عدد العمليات: {summary.transactionCount}</p>
            {summary.canteen && <a className="table-link" href={`/canteens/${summary.canteen.id}`}>تفاصيل المقصف</a>}
            <button onClick={() => void settle(summary)} disabled={Number(summary.net) <= 0}>تم سداد المقصف</button>
          </article>
        ))}
      </div>
      <h2>سجل التسويات</h2>
      <form className="entry student-tools">
        <label>من تاريخ<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <button type="button" className="secondary" onClick={() => { setStartDate(''); setEndDate(''); }}>مسح الفترة</button>
        <small className="form-note">التسويات المعروضة: {visibleSettlements.length}</small>
      </form>
      <table><thead><tr><th>التاريخ</th><th>المقصف</th><th>المشغّل</th><th>المدرسة</th><th>الفترة</th><th>عدد العمليات</th><th>المبلغ</th><th>سجلها</th><th>ملاحظة/إيصال</th></tr></thead><tbody>{visibleSettlements.map(item => <tr key={item.id}><td>{new Date(item.createdAt).toLocaleString('ar-SA')}</td><td>{item.canteen?.name ?? 'مقصف قديم'}</td><td>{item.canteenUser.email}</td><td>{item.school?.name ?? '—'}</td><td>{new Date(item.periodStart).toLocaleDateString('ar-SA')} - {new Date(item.periodEnd).toLocaleDateString('ar-SA')}</td><td>{item.transactionCount}</td><td>{item.amount} ر.س</td><td>{item.settledBy.email}</td><td>{item.note ?? '—'}</td></tr>)}</tbody></table>
    </AdminShell>
  );
}
