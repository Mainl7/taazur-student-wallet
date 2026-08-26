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
  settled: string;
  settlementCount: number;
  lastSettlementAt: string | null;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
};

type OwnerSummary = {
  summaries?: Summary[];
  settlements?: Settlement[];
  totals?: {
    debit: string;
    refund: string;
    net: string;
    settled: string;
    transactionCount: number;
    canteenCount: number;
  };
  error?: string;
};

type Settlement = {
  id: string;
  amount: string;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  canteen?: { name: string; canteenCode?: string | null; school?: { name: string; schoolCode: string } } | null;
  school?: { name: string; schoolCode: string } | null;
  settledBy: { email: string };
};

export default function CanteenOwnerPage() {
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [totals, setTotals] = useState<OwnerSummary['totals'] | null>(null);
  const [message, setMessage] = useState('جاري تحميل بيانات المقاصف...');

  useEffect(() => {
    const load = async () => {
      const me = await apiFetch('/auth/me');
      if (me.status === 401) return location.assign('/login');
      const meData: { user?: { role: string; schoolId?: string | null } } = await me.json();
      if (!['CANTEEN_OWNER', 'CANTEEN_OPERATOR'].includes(meData.user?.role ?? '')) {
        location.assign('/');
        return;
      }
      if (meData.user?.role === 'CANTEEN_OPERATOR' && meData.user.schoolId) {
        location.assign('/canteen');
        return;
      }

      const response = await apiFetch('/canteen/owner-summary');
      const data: OwnerSummary = await response.json();
      if (!response.ok) {
        setMessage(`تعذر تحميل بيانات المقاصف: ${data.error ?? 'UNKNOWN_ERROR'}`);
        return;
      }

      setSummaries(Array.isArray(data.summaries) ? data.summaries : []);
      setSettlements(Array.isArray(data.settlements) ? data.settlements : []);
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
            <span>هنا تظهر بيانات المقاصف التابعة لك فقط: مستحقات الفسحة الحالية والمبالغ التي تمت تسويتها من الجمعية</span>
          </div>
          <div className="owner-actions">
            <LogoutButton />
          </div>
        </header>

        <div className="cards owner-cards">
          <article><small>مستحقات المقاصف على الجمعية</small><b>{totals?.net ?? '0.00'} ر.س</b></article>
          <article><small>مبالغ تمت تسويتها</small><b>{totals?.settled ?? '0.00'} ر.س</b></article>
          <article><small>إجمالي مصروفات الفسحة</small><b>{totals?.debit ?? '0.00'} ر.س</b></article>
          <article><small>إجمالي الاسترجاع</small><b>{totals?.refund ?? '0.00'} ر.س</b></article>
          <article><small>عدد عمليات الفسحة</small><b>{totals?.transactionCount ?? 0}</b></article>
        </div>

        {message && <p role="status">{message}</p>}

        <h2>المقاصف التابعة لك</h2>
        <table>
          <thead>
            <tr>
              <th>المقصف</th>
              <th>المدرسة</th>
              <th>المستحق الحالي</th>
              <th>مصروفات الفسحة</th>
              <th>الاسترجاع</th>
              <th>عدد العمليات</th>
              <th>تمت تسويته</th>
              <th>عدد التسويات</th>
              <th>آخر تسوية</th>
              <th>التفاصيل</th>
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
                <td>{summary.settled} ر.س</td>
                <td>{summary.settlementCount}</td>
                <td>{summary.lastSettlementAt ? new Date(summary.lastSettlementAt).toLocaleDateString('ar-SA') : 'لم تتم تسوية سابقة'}</td>
                <td>{summary.canteen?.id ? <a className="table-link" href={`/canteens/${summary.canteen.id}`}>تفاصيل</a> : '—'}</td>
              </tr>
            ))}
            {!summaries.length && <tr><td colSpan={10}>لا توجد مقاصف مربوطة بهذا الحساب حتى الآن. اطلب من المدير ربط المقاصف التابعة لك.</td></tr>}
          </tbody>
        </table>

        <h2>آخر التسويات</h2>
        <table>
          <thead>
            <tr>
              <th>تاريخ التسوية</th>
              <th>المقصف</th>
              <th>المدرسة</th>
              <th>الفترة</th>
              <th>عدد العمليات</th>
              <th>المبلغ المسدد</th>
              <th>سجلها</th>
            </tr>
          </thead>
          <tbody>
            {settlements.map(settlement => (
              <tr key={settlement.id}>
                <td>{new Date(settlement.createdAt).toLocaleString('ar-SA')}</td>
                <td>{settlement.canteen?.name ?? 'مقصف عام'}</td>
                <td>{settlement.canteen?.school?.name ?? settlement.school?.name ?? '—'}</td>
                <td>{new Date(settlement.periodStart).toLocaleDateString('ar-SA')} - {new Date(settlement.periodEnd).toLocaleDateString('ar-SA')}</td>
                <td>{settlement.transactionCount}</td>
                <td>{settlement.amount} ر.س</td>
                <td>{settlement.settledBy.email}</td>
              </tr>
            ))}
            {!settlements.length && <tr><td colSpan={7}>لا توجد تسويات مسجلة حتى الآن.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
