'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import AdminShell from '../../components/AdminShell';
import { apiFetch } from '../../lib/api';

type StudentDetails = {
  student: {
    id: string;
    studentCode: string;
    fullName: string;
    grade: string;
    className?: string | null;
    status: string;
    dailyLimit: string;
    weeklyLimit?: string | null;
    school: { name: string; schoolCode: string; city: string };
    wallet: { balance: string; currency: string; status: string; updatedAt: string } | null;
    cards: Array<{ id: string; publicToken: string; status: string; issuedAt: string; revokedAt?: string | null; expiresAt?: string | null }>;
  };
  transactions: Array<{
    id: string;
    reference: string;
    type: string;
    amount: string;
    balanceBefore: string;
    balanceAfter: string;
    createdAt: string;
    canteen?: { name: string; canteenCode?: string | null } | null;
    performedBy: { email: string };
  }>;
  totals: Record<string, string>;
};

const labels: Record<string, string> = { CREDIT: 'تخصيص فسحة', DEBIT: 'صرف مقصف', REFUND: 'استرجاع', REVERSAL: 'عكس', ADJUSTMENT: 'تسوية' };

export default function StudentDetailsPage() {
  const params = useParams<{ studentId: string }>();
  const [data, setData] = useState<StudentDetails | null>(null);
  const [message, setMessage] = useState('جاري تحميل ملف الطالب...');

  const load = async () => {
    const response = await apiFetch(`/students/${params.studentId}/details`);
    if (response.status === 401) return location.assign('/login');
    const nextData: StudentDetails & { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر تحميل ملف الطالب: ${nextData.error ?? 'UNKNOWN_ERROR'}`);
    setData(nextData);
    setMessage('');
  };

  useEffect(() => {
    void load();
  }, [params.studentId]);

  async function revokeCard(cardId: string) {
    if (!confirm('سيتم إلغاء هذه البطاقة ولن تعمل عند المقصف. هل تريد المتابعة؟')) return;
    const response = await apiFetch(`/cards/${cardId}/revoke`, { method: 'POST' });
    if (!response.ok) return setMessage('تعذر إلغاء البطاقة.');
    setMessage('تم إلغاء البطاقة.');
    void load();
  }

  async function replaceCard() {
    if (!confirm('سيتم إلغاء البطاقة النشطة وإصدار بطاقة QR جديدة للطالب. هل تريد المتابعة؟')) return;
    const response = await apiFetch(`/students/${params.studentId}/cards`, { method: 'POST' });
    if (!response.ok) return setMessage('تعذر إصدار بطاقة بديلة.');
    setMessage('تم إصدار بطاقة بديلة. اطبع البطاقة الجديدة من صفحة الطلاب أو البطاقات.');
    void load();
  }

  const activeCards = useMemo(() => data?.student.cards.filter(card => card.status === 'ACTIVE') ?? [], [data]);
  const revokedCards = useMemo(() => data?.student.cards.filter(card => card.status !== 'ACTIVE') ?? [], [data]);

  return (
    <AdminShell>
      <header>
        <div>
          <h1>{data?.student.fullName ?? 'ملف الطالب'}</h1>
          <span>{data?.student.studentCode ?? '—'} — {data?.student.school.name ?? '—'}</span>
        </div>
        <a href="/students">← الطلاب</a>
      </header>

      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <div className="cards">
            <article><small>رصيد الفسحة المتاح</small><b>{data.student.wallet ? `${data.student.wallet.balance} ${data.student.wallet.currency}` : '—'}</b></article>
            <article><small>الحد اليومي</small><b>{data.student.dailyLimit} ر.س</b></article>
            <article><small>إجمالي المخصص من الجمعية</small><b>{data.totals.CREDIT ?? '0.00'} ر.س</b></article>
            <article><small>إجمالي المصروف في المقصف</small><b>{data.totals.DEBIT ?? '0.00'} ر.س</b></article>
          </div>

          <section className="dashboard-section">
            <h2>بيانات الطالب</h2>
            <table><tbody>
              <tr><th>الاسم</th><td>{data.student.fullName}</td><th>الرمز</th><td>{data.student.studentCode}</td></tr>
              <tr><th>الصف</th><td>{data.student.grade}</td><th>الحالة</th><td>{data.student.status}</td></tr>
              <tr><th>المدرسة</th><td>{data.student.school.name}</td><th>المدينة</th><td>{data.student.school.city}</td></tr>
            </tbody></table>
          </section>

          <h2>البطاقات</h2>
          <div className="row-actions">
            <button type="button" onClick={() => void replaceCard()}>إصدار بطاقة بديلة</button>
          </div>
          <table>
            <thead><tr><th>رمز البطاقة</th><th>الحالة</th><th>تاريخ الإصدار</th><th>تاريخ الإلغاء</th><th>الإجراء</th></tr></thead>
            <tbody>
              {[...activeCards, ...revokedCards].map(card => <tr key={card.id}><td className="token">{card.publicToken}</td><td>{card.status}</td><td>{new Date(card.issuedAt).toLocaleString('ar-SA')}</td><td>{card.revokedAt ? new Date(card.revokedAt).toLocaleString('ar-SA') : '—'}</td><td>{card.status === 'ACTIVE' ? <button type="button" className="danger-button" onClick={() => void revokeCard(card.id)}>إلغاء البطاقة</button> : '—'}</td></tr>)}
            </tbody>
          </table>

          <h2>سجل العمليات</h2>
          <table>
            <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>المقصف/المستخدم</th><th>المرجع</th></tr></thead>
            <tbody>
              {data.transactions.map(transaction => <tr key={transaction.id}><td>{new Date(transaction.createdAt).toLocaleString('ar-SA')}</td><td>{labels[transaction.type] ?? transaction.type}</td><td>{transaction.amount} ر.س</td><td>{transaction.balanceBefore}</td><td>{transaction.balanceAfter}</td><td>{transaction.canteen?.name ?? transaction.performedBy.email}</td><td className="token">{transaction.reference}</td></tr>)}
            </tbody>
          </table>
        </>
      )}
    </AdminShell>
  );
}
