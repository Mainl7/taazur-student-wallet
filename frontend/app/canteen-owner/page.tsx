'use client';

import { useEffect, useState } from 'react';
import BrandLogo from '../components/BrandLogo';
import LogoutButton from '../components/LogoutButton';
import { apiFetch } from '../lib/api';

type Summary = {
  canteenUser: { email: string };
  canteen?: {
    id: string;
    name: string;
    canteenCode?: string | null;
    school: { name: string; schoolCode: string };
  } | null;
  debit: string;
  refund: string;
  net: string;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
};

type OwnerSummary = {
  summaries?: Summary[];
  totals?: {
    debit: string;
    refund: string;
    net: string;
    transactionCount: number;
    canteenCount: number;
  };
  error?: string;
};

export default function CanteenOwnerPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [totals, setTotals] = useState<OwnerSummary['totals'] | null>(null);
  const [message, setMessage] = useState('جاري تحميل بيانات المقاصف...');

  useEffect(() => {
    const load = async () => {
      const me = await apiFetch('/auth/me');
      if (me.status === 401) return location.assign('/login');
      const meData: { user?: { role: string } } = await me.json();
      if (meData.user?.role !== 'CANTEEN_OPERATOR') {
        location.assign('/');
        return;
      }

      const response = await apiFetch('/canteen/owner-summary');
      const data: OwnerSummary = await response.json();
      if (!response.ok) {
        setMessage(`تعذر تحميل بيانات المقاصف: ${data.error ?? 'UNKNOWN_ERROR'}`);
        return;
      }

      setSummaries(Array.isArray(data.summaries) ? data.summaries : []);
      setTotals(data.totals ?? null);
      setMessage('');
    };

    void load();
  }, []);

  return (
    <main className="owner-portal">
      <section className="owner-shell">
        <header className="owner-header">
          <BrandLogo compact />
          <div>
            <h1>واجهة مالك المقصف</h1>
            <span>هنا تظهر كل المقاصف التابعة لك، وكل مقصف مربوط بمدرسته ومصاريفه الحالية</span>
          </div>
          <div className="owner-actions">
            <a href="/canteen">فتح شاشة المحاسبة</a>
            <LogoutButton />
          </div>
        </header>

        <div className="cards owner-cards">
          <article><small>مستحقات المقاصف الحالية</small><b>{totals?.net ?? '0.00'} ر.س</b></article>
          <article><small>إجمالي الخصومات</small><b>{totals?.debit ?? '0.00'} ر.س</b></article>
          <article><small>إجمالي الاسترجاع</small><b>{totals?.refund ?? '0.00'} ر.س</b></article>
          <article><small>عدد عمليات الخصم</small><b>{totals?.transactionCount ?? 0}</b></article>
        </div>

        {message && <p role="status">{message}</p>}

        <h2>المقاصف التابعة لك</h2>
        <table>
          <thead>
            <tr>
              <th>المقصف</th>
              <th>المدرسة</th>
              <th>المستحق الحالي</th>
              <th>الخصومات</th>
              <th>الاسترجاع</th>
              <th>عدد العمليات</th>
              <th>آخر تسوية</th>
              <th>الإجراء</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map(summary => (
              <tr key={summary.canteen?.id ?? summary.canteenUser.email}>
                <td>{summary.canteen?.name ?? 'مقصف عام'}</td>
                <td>{summary.canteen?.school.name ?? 'غير محدد'}</td>
                <td>{summary.net} ر.س</td>
                <td>{summary.debit} ر.س</td>
                <td>{summary.refund} ر.س</td>
                <td>{summary.transactionCount}</td>
                <td>{new Date(summary.periodStart).getTime() === 0 ? 'لم تتم تسوية سابقة' : new Date(summary.periodStart).toLocaleDateString('ar-SA')}</td>
                <td>{summary.canteen?.id ? <a className="table-link" href={`/canteen?canteenId=${summary.canteen.id}`}>فتح المحاسبة</a> : <a className="table-link" href="/canteen">فتح المحاسبة</a>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
