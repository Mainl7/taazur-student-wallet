'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Student = {
  id: string;
  studentCode: string;
  fullName: string;
  grade: string;
  className?: string | null;
  status: string;
  dailyLimit: number;
  balance: number;
  currency: string;
  hasActiveCard: boolean;
};

type Transaction = {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  createdAt: string;
  reference: string;
  studentName: string;
  studentCode: string;
  canteenName: string;
};

type Overview = {
  school: { name: string; schoolCode: string; city: string; district?: string | null; status: string };
  summary: {
    students: number;
    activeStudents: number;
    walletBalance: number;
    todaySpent: number;
    todayTransactions: number;
    weekSpent: number;
    monthSpent: number;
    activeCards: number;
    revokedCards: number;
    lowBalanceCount: number;
    dailyLimitReachedCount: number;
  };
  alerts: {
    lowBalances: Array<{ studentId: string; fullName: string; studentCode: string; balance: number }>;
    dailyLimitReached: Array<{ studentId: string; fullName: string; studentCode: string; spentToday: number; dailyLimit: number }>;
  };
  students: Student[];
  recentTransactions: Transaction[];
};

type SearchKey = 'studentCode' | 'fullName' | 'grade' | 'status';

const currency = new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' });

function money(value: number) {
  return currency.format(value);
}

function labelStatus(status: string) {
  if (status === 'ACTIVE') return 'نشط';
  if (status === 'INACTIVE') return 'غير نشط';
  return status;
}

function transactionType(type: string) {
  if (type === 'DEBIT') return 'شراء';
  if (type === 'REFUND') return 'استرجاع';
  if (type === 'CREDIT') return 'شحن';
  return type;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('ar-SA').replace(/\s+/g, ' ');
}

function downloadCsv(filename: string, rows: Array<Record<string, string | number>>) {
  const headers = Object.keys(rows[0] ?? { empty: '' });
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(header => `"${String(row[header] ?? '').replaceAll('"', '""')}"`).join(','))
  ].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function SchoolManagerPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [message, setMessage] = useState('');
  const [searchKey, setSearchKey] = useState<SearchKey>('fullName');
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    const response = await apiFetch('/school-manager/overview');
    if (response.status === 401) return location.assign('/login');
    const data: { error?: string } & Partial<Overview> = await response.json();
    if (!response.ok) return setMessage(`تعذر تحميل بيانات المدرسة: ${data.error ?? 'UNKNOWN_ERROR'}`);
    setOverview(data as Overview);
  };

  useEffect(() => { void load(); }, []);

  const visibleStudents = useMemo(() => {
    const text = normalize(searchText);
    return (overview?.students ?? []).filter(student => {
      const searchable = searchKey === 'status' ? labelStatus(student.status) : String(student[searchKey] ?? '');
      const matchesText = !text || normalize(searchable).includes(text);
      const matchesStatus = !statusFilter || student.status === statusFilter;
      return matchesText && matchesStatus;
    });
  }, [overview?.students, searchKey, searchText, statusFilter]);

  const exportStudents = () => {
    downloadCsv('school-students.csv', visibleStudents.map(student => ({
      'رمز الطالب': student.studentCode,
      'اسم الطالب': student.fullName,
      'الصف': student.grade,
      'الفصل': student.className ?? '',
      'الحالة': labelStatus(student.status),
      'الرصيد': student.balance,
      'حد الفسحة اليومي': student.dailyLimit,
      'بطاقة نشطة': student.hasActiveCard ? 'نعم' : 'لا'
    })));
  };

  if (!overview) {
    return (
      <AdminShell>
        <header><div><h1>واجهة مدير المدرسة</h1><span>جاري تحميل بيانات المدرسة...</span></div></header>
        {message && <p role="alert">{message}</p>}
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>واجهة مدير المدرسة</h1>
          <span>{overview.school.name} — {overview.school.schoolCode}</span>
        </div>
        <button onClick={load}>تحديث</button>
      </header>

      {message && <p role="alert">{message}</p>}

      <div className="cards dashboard-cards">
        <article><small>إجمالي رصيد الطلاب</small><b>{money(overview.summary.walletBalance)}</b></article>
        <article><small>مصروف اليوم</small><b>{money(overview.summary.todaySpent)}</b></article>
        <article><small>عمليات اليوم</small><b>{overview.summary.todayTransactions}</b></article>
        <article><small>مصروف آخر 7 أيام</small><b>{money(overview.summary.weekSpent)}</b></article>
        <article><small>مصروف الشهر</small><b>{money(overview.summary.monthSpent)}</b></article>
        <article><small>الطلاب النشطون</small><b>{overview.summary.activeStudents}</b></article>
        <article><small>البطاقات الملغاة</small><b>{overview.summary.revokedCards}</b></article>
      </div>

      <section className="dashboard-section two-columns">
        <div className="panel">
          <h2>تنبيهات تحتاج متابعة</h2>
          <div className="alert-timeline">
            {overview.alerts.lowBalances.length === 0 && overview.alerts.dailyLimitReached.length === 0 && <p className="empty-state">لا توجد تنبيهات حالية لهذه المدرسة.</p>}
            {overview.alerts.lowBalances.map(alert => (
              <article className="alert-row warn" key={`low-${alert.studentId}`}>
                <span className="alert-badge">رصيد منخفض</span>
                <strong>{alert.fullName}</strong>
                <small>{alert.studentCode}</small>
                <b>{money(alert.balance)}</b>
              </article>
            ))}
            {overview.alerts.dailyLimitReached.map(alert => (
              <article className="alert-row danger" key={`limit-${alert.studentId}`}>
                <span className="alert-badge">وصل الحد</span>
                <strong>{alert.fullName}</strong>
                <small>{alert.studentCode}</small>
                <b>{money(alert.spentToday)} / {money(alert.dailyLimit)}</b>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>آخر العمليات</h2>
          <div className="activity-feed">
            {overview.recentTransactions.slice(0, 8).map(transaction => (
              <article key={transaction.id}>
                <strong>{transactionType(transaction.type)} — {money(transaction.amount)}</strong>
                <span>{transaction.studentName} ({transaction.studentCode})</span>
                <small>{transaction.canteenName} — {new Date(transaction.createdAt).toLocaleString('ar-SA')}</small>
              </article>
            ))}
            {overview.recentTransactions.length === 0 && <p className="empty-state">لا توجد عمليات حتى الآن.</p>}
          </div>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <h2>طلاب المدرسة</h2>
            <span>عرض فقط، بدون تعديل على بيانات الطلاب أو المحافظ</span>
          </div>
          <button className="secondary" onClick={exportStudents}>تصدير الطلاب الظاهرين CSV</button>
        </div>

        <div className="filter-panel">
          <strong>بحث وفرز الطلاب</strong>
          <label>ابحث حسب
            <select value={searchKey} onChange={event => setSearchKey(event.target.value as SearchKey)}>
              <option value="fullName">اسم الطالب</option>
              <option value="studentCode">رمز الطالب</option>
              <option value="grade">الصف</option>
              <option value="status">الحالة</option>
            </select>
          </label>
          <label>كلمة البحث
            <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="اكتب للبحث داخل طلاب المدرسة" />
          </label>
          <label>الحالة
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="">كل الحالات</option>
              <option value="ACTIVE">نشط</option>
              <option value="INACTIVE">غير نشط</option>
            </select>
          </label>
        </div>

        <table>
          <thead>
            <tr>
              <th>الرمز</th>
              <th>اسم الطالب</th>
              <th>الصف</th>
              <th>الرصيد</th>
              <th>حد الفسحة اليومي</th>
              <th>البطاقة</th>
              <th>الحالة</th>
            </tr>
          </thead>
          <tbody>
            {visibleStudents.map(student => (
              <tr key={student.id}>
                <td>{student.studentCode}</td>
                <td>{student.fullName}</td>
                <td>{student.grade}{student.className ? ` / ${student.className}` : ''}</td>
                <td>{money(student.balance)}</td>
                <td>{money(student.dailyLimit)}</td>
                <td>{student.hasActiveCard ? 'مفعّلة' : 'لا توجد بطاقة نشطة'}</td>
                <td>{labelStatus(student.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
