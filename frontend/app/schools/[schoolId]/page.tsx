'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AdminShell from '../../components/AdminShell';
import { apiFetch } from '../../lib/api';

type SchoolDetails = {
  school: { id: string; schoolCode: string; name: string; city: string; district?: string | null; address?: string | null; status: string; createdAt: string };
  metrics: { students: number; activeStudents: number; walletBalance: string; todaySpent: string; todayTransactions: number; monthSpent: string; monthTransactions: number; lowBalanceCount: number; revokedCards: number };
  canteens: Array<{ id: string; name: string; canteenCode?: string | null; status: string; operator: { email: string } }>;
};

export default function SchoolDetailsPage() {
  const params = useParams<{ schoolId: string }>();
  const [data, setData] = useState<SchoolDetails | null>(null);
  const [message, setMessage] = useState('جاري تحميل تفاصيل المدرسة...');

  useEffect(() => {
    const load = async () => {
      const response = await apiFetch(`/schools/${params.schoolId}/details`);
      if (response.status === 401) return location.assign('/login');
      const nextData: SchoolDetails & { error?: string } = await response.json();
      if (!response.ok) return setMessage(`تعذر تحميل تفاصيل المدرسة: ${nextData.error ?? 'UNKNOWN_ERROR'}`);
      setData(nextData);
      setMessage('');
    };
    void load();
  }, [params.schoolId]);

  return (
    <AdminShell>
      <header>
        <div>
          <h1>{data?.school.name ?? 'تفاصيل المدرسة'}</h1>
          <span>{data?.school.schoolCode ?? '—'} — {data?.school.city ?? '—'}</span>
        </div>
        <a href="/schools">← المدارس</a>
      </header>

      {message && <p role="status">{message}</p>}

      {data && (
        <>
          <div className="cards">
            <article><small>الطلاب النشطون</small><b>{data.metrics.activeStudents}</b></article>
            <article><small>إجمالي رصيد الفسحة</small><b>{data.metrics.walletBalance} ر.س</b></article>
            <article><small>مصروفات اليوم</small><b>{data.metrics.todaySpent} ر.س</b></article>
            <article><small>مصروفات الشهر</small><b>{data.metrics.monthSpent} ر.س</b></article>
          </div>

          <section className="dashboard-section">
            <h2>بيانات المدرسة</h2>
            <table><tbody>
              <tr><th>الاسم</th><td>{data.school.name}</td><th>الرمز</th><td>{data.school.schoolCode}</td></tr>
              <tr><th>المدينة</th><td>{data.school.city}</td><th>الحي</th><td>{data.school.district ?? '—'}</td></tr>
              <tr><th>الحالة</th><td>{data.school.status}</td><th>العنوان</th><td>{data.school.address ?? '—'}</td></tr>
              <tr><th>كل الطلاب</th><td>{data.metrics.students}</td><th>بطاقات ملغاة</th><td>{data.metrics.revokedCards}</td></tr>
              <tr><th>طلاب رصيدهم منخفض</th><td>{data.metrics.lowBalanceCount}</td><th>عمليات اليوم</th><td>{data.metrics.todayTransactions}</td></tr>
            </tbody></table>
          </section>

          <h2>المقاصف المرتبطة</h2>
          <table>
            <thead><tr><th>المقصف</th><th>الرمز</th><th>المشغل/المالك</th><th>الحالة</th><th>التفاصيل</th></tr></thead>
            <tbody>
              {data.canteens.map(canteen => <tr key={canteen.id}><td>{canteen.name}</td><td>{canteen.canteenCode ?? '—'}</td><td>{canteen.operator.email}</td><td>{canteen.status}</td><td><a className="table-link" href={`/canteens/${canteen.id}`}>تفاصيل</a></td></tr>)}
              {!data.canteens.length && <tr><td colSpan={5}>لا توجد مقاصف مرتبطة بهذه المدرسة.</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </AdminShell>
  );
}
