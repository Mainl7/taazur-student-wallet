'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import BrandLogo from '../../components/BrandLogo';
import LogoutButton from '../../components/LogoutButton';
import { apiFetch } from '../../lib/api';

type CanteenDetails = {
  summary: {
    canteenUser: { email: string };
    canteen: { id: string; name: string; canteenCode?: string | null; school: { name: string; schoolCode: string } };
    debit: string;
    refund: string;
    net: string;
    settled: string;
    transactionCount: number;
    settlementCount: number;
    lastSettlementAt?: string | null;
  };
  transactions: Array<{
    id: string;
    reference: string;
    type: string;
    amount: string;
    balanceBefore: string;
    balanceAfter: string;
    createdAt: string;
    student?: { fullName: string; studentCode: string };
    performedBy: { email: string };
  }>;
  settlements: Array<{
    id: string;
    amount: string;
    transactionCount: number;
    periodStart: string;
    periodEnd: string;
    createdAt: string;
    settledBy: { email: string };
  }>;
};

const labels: Record<string, string> = { CREDIT: 'تخصيص فسحة', DEBIT: 'صرف مقصف', REFUND: 'استرجاع', REVERSAL: 'عكس', ADJUSTMENT: 'تسوية' };

export default function CanteenDetailsPage() {
  const params = useParams<{ canteenId: string }>();
  const [data, setData] = useState<CanteenDetails | null>(null);
  const [message, setMessage] = useState('جاري تحميل تفاصيل المقصف...');

  useEffect(() => {
    const load = async () => {
      const response = await apiFetch(`/canteens/${params.canteenId}/details`);
      if (response.status === 401) return location.assign('/login');
      const nextData: CanteenDetails & { error?: string } = await response.json();
      if (!response.ok) return setMessage(`تعذر تحميل تفاصيل المقصف: ${nextData.error ?? 'UNKNOWN_ERROR'}`);
      setData(nextData);
      setMessage('');
    };
    void load();
  }, [params.canteenId]);

  const backHref = typeof window !== 'undefined' && document.referrer.includes('/canteen-owner') ? '/canteen-owner' : '/canteen-settlements';

  return (
    <main className="owner-portal">
      <section className="owner-shell">
      <header className="owner-header">
        <BrandLogo compact />
        <div>
          <h1>{data?.summary.canteen.name ?? 'تفاصيل المقصف'}</h1>
          <span>{data?.summary.canteen.school.name ?? '—'} — {data?.summary.canteen.canteenCode ?? 'بدون رمز'}</span>
        </div>
        <div className="owner-actions">
          <a href={backHref}>← رجوع</a>
          <LogoutButton />
        </div>
      </header>

      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <div className="cards">
            <article><small>المستحق الحالي على الجمعية</small><b>{data.summary.net} ر.س</b></article>
            <article><small>إجمالي مصروفات الفسحة</small><b>{data.summary.debit} ر.س</b></article>
            <article><small>إجمالي الاسترجاع</small><b>{data.summary.refund} ر.س</b></article>
            <article><small>تمت تسويته</small><b>{data.summary.settled} ر.س</b></article>
          </div>

          <section className="dashboard-section">
            <h2>بيانات المقصف</h2>
            <table><tbody>
              <tr><th>المقصف</th><td>{data.summary.canteen.name}</td><th>المدرسة</th><td>{data.summary.canteen.school.name}</td></tr>
              <tr><th>مالك المقصف</th><td>{data.summary.canteenUser.email}</td><th>عدد العمليات</th><td>{data.summary.transactionCount}</td></tr>
              <tr><th>عدد التسويات</th><td>{data.summary.settlementCount}</td><th>آخر تسوية</th><td>{data.summary.lastSettlementAt ? new Date(data.summary.lastSettlementAt).toLocaleString('ar-SA') : 'لم تتم تسوية سابقة'}</td></tr>
            </tbody></table>
          </section>

          <h2>سجل التسويات</h2>
          <table>
            <thead><tr><th>التاريخ</th><th>الفترة</th><th>عدد العمليات</th><th>المبلغ</th><th>سجلها</th></tr></thead>
            <tbody>
              {data.settlements.map(settlement => <tr key={settlement.id}><td>{new Date(settlement.createdAt).toLocaleString('ar-SA')}</td><td>{new Date(settlement.periodStart).toLocaleDateString('ar-SA')} - {new Date(settlement.periodEnd).toLocaleDateString('ar-SA')}</td><td>{settlement.transactionCount}</td><td>{settlement.amount} ر.س</td><td>{settlement.settledBy.email}</td></tr>)}
              {!data.settlements.length && <tr><td colSpan={5}>لا توجد تسويات مسجلة لهذا المقصف.</td></tr>}
            </tbody>
          </table>

          <h2>آخر العمليات</h2>
          <table>
            <thead><tr><th>التاريخ</th><th>الطالب</th><th>النوع</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>الكاشير</th><th>المرجع</th></tr></thead>
            <tbody>
              {data.transactions.map(transaction => <tr key={transaction.id}><td>{new Date(transaction.createdAt).toLocaleString('ar-SA')}</td><td>{transaction.student ? `${transaction.student.fullName} — ${transaction.student.studentCode}` : '—'}</td><td>{labels[transaction.type] ?? transaction.type}</td><td>{transaction.amount} ر.س</td><td>{transaction.balanceBefore}</td><td>{transaction.balanceAfter}</td><td>{transaction.performedBy.email}</td><td className="token">{transaction.reference}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
      </section>
    </main>
  );
}
