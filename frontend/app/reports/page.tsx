'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type MoneyMetric = { amount: string; count: number };
type Spending = { schoolId: string; schoolName: string; schoolCode: string; daily: MoneyMetric; weekly: MoneyMetric; monthly: MoneyMetric };
type TopItem = { schoolName: string; fullName?: string; studentCode?: string; amount: string; count: number };
type DayItem = { date: string; debit: string; refund: string; net: string; count: number };
type InactiveStudent = { id: string; fullName: string; studentCode: string; schoolName: string };
type Usage = { studentId: string; fullName: string; studentCode: string; schoolName: string; dailyCount: number; weeklyCount: number; monthlyCount: number; monthlyAmount: string };
type Report = { spendingBySchool: Spending[]; topStudents: TopItem[]; topSchools: TopItem[]; canteenByDay: DayItem[]; inactiveStudents: InactiveStudent[]; studentUsage: Usage[] };
type School = { id: string; name: string; schoolCode: string };

const currentMonth = new Date().toISOString().slice(0, 7);

export default function ReportsPage() {
  const [month, setMonth] = useState(currentMonth);
  const [schoolId, setSchoolId] = useState('');
  const [schools, setSchools] = useState<School[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState('');
  const query = useMemo(() => new URLSearchParams({ month, ...(schoolId ? { schoolId } : {}) }).toString(), [month, schoolId]);

  const load = async () => {
    const response = await apiFetch(`/reports/summary?${query}`);
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('تعذر تحميل التقارير.');
    setReport(await response.json());
    setMessage('');
  };

  useEffect(() => {
    const boot = async () => {
      const schoolsResponse = await apiFetch('/schools');
      if (schoolsResponse.status === 401) return location.assign('/login');
      const schoolData: { schools?: School[] } = await schoolsResponse.json();
      setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
      await load();
    };
    void boot();
  }, []);

  return (
    <AdminShell>
      <header>
        <div><h1>التقارير</h1><span>مصروفات المدارس واستخدام الطلاب وعمليات المقصف</span></div>
        <div className="row-actions">
          <label>الشهر<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
          <label>المدرسة<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">كل المدارس</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}</select></label>
          <button onClick={() => void load()}>تحديث التقرير</button>
          <a href={`/exports/monthly-expenses.xls?${query}`}>Excel</a>
          <a href={`/exports/monthly-expenses-print?${query}`} target="_blank">PDF</a>
        </div>
      </header>
      {message && <p role="status">{message}</p>}

      <h2>إجمالي المصروف لكل مدرسة</h2>
      <div className="report-grid">
        {report?.spendingBySchool.map(school => (
          <article className="metric-card" key={school.schoolId}>
            <small>{school.schoolCode}</small>
            <h3>{school.schoolName}</h3>
            <dl><dt>اليوم</dt><dd>{school.daily.amount} ر.س / {school.daily.count} عملية</dd><dt>الأسبوع</dt><dd>{school.weekly.amount} ر.س / {school.weekly.count} عملية</dd><dt>الشهر</dt><dd>{school.monthly.amount} ر.س / {school.monthly.count} عملية</dd></dl>
          </article>
        ))}
      </div>

      <div className="two-columns">
        <section className="panel"><h2>أكثر الطلاب استخدامًا</h2><table><thead><tr><th>الطالب</th><th>المدرسة</th><th>العمليات</th><th>الإجمالي</th></tr></thead><tbody>{report?.topStudents.map(item => <tr key={`${item.studentCode}-${item.schoolName}`}><td>{item.fullName} — {item.studentCode}</td><td>{item.schoolName}</td><td>{item.count}</td><td>{item.amount} ر.س</td></tr>)}</tbody></table></section>
        <section className="panel"><h2>أكثر المدارس نشاطًا</h2><table><thead><tr><th>المدرسة</th><th>العمليات</th><th>الإجمالي</th></tr></thead><tbody>{report?.topSchools.map(item => <tr key={item.schoolName}><td>{item.schoolName}</td><td>{item.count}</td><td>{item.amount} ر.س</td></tr>)}</tbody></table></section>
      </div>

      <h2>عمليات المقصف حسب اليوم</h2>
      <table><thead><tr><th>اليوم</th><th>مصروفات الفسحة</th><th>الاسترجاع</th><th>الصافي</th><th>عدد عمليات الفسحة</th></tr></thead><tbody>{report?.canteenByDay.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.debit} ر.س</td><td>{day.refund} ر.س</td><td>{day.net} ر.س</td><td>{day.count}</td></tr>)}</tbody></table>

      <h2>استخدام الطلاب حسب المدرسة</h2>
      <table><thead><tr><th>المدرسة</th><th>الطالب</th><th>اليوم</th><th>الأسبوع</th><th>الشهر</th><th>مصروف الشهر</th></tr></thead><tbody>{report?.studentUsage.map(item => <tr key={item.studentId}><td>{item.schoolName}</td><td>{item.fullName} — {item.studentCode}</td><td>{item.dailyCount}</td><td>{item.weeklyCount}</td><td>{item.monthlyCount}</td><td>{item.monthlyAmount} ر.س</td></tr>)}</tbody></table>

      <h2>طلاب لم يستخدموا بطاقاتهم هذا الشهر</h2>
      <table><thead><tr><th>المدرسة</th><th>الطالب</th><th>رمز الطالب</th></tr></thead><tbody>{report?.inactiveStudents.map(student => <tr key={student.id}><td>{student.schoolName}</td><td>{student.fullName}</td><td>{student.studentCode}</td></tr>)}</tbody></table>
    </AdminShell>
  );
}
