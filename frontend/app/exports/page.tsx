'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; name: string; schoolCode: string };

const currentMonth = new Date().toISOString().slice(0, 7);

const apiExportUrl = (path: string, query = '') => `/api/v1/exports/${path}${query ? `?${query}` : ''}`;

export default function ExportsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [message, setMessage] = useState('');
  const query = useMemo(() => new URLSearchParams({ month, ...(schoolId ? { schoolId } : {}) }).toString(), [month, schoolId]);
  const schoolQuery = useMemo(() => schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : '', [schoolId]);

  useEffect(() => {
    const load = async () => {
      const response = await apiFetch('/schools');
      if (response.status === 401) return location.assign('/login');
      const data: { schools?: School[] } = await response.json();
      setSchools(Array.isArray(data.schools) ? data.schools : []);
    };
    void load();
  }, []);

  return (
    <AdminShell>
      <header><div><h1>التصدير والطباعة</h1><span>ملفات للمدرسة أو لكل المدارس حسب صلاحية الحساب</span></div></header>
      <form className="entry">
        <label>الشهر<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
        <label>المدرسة<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">كل المدارس</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}</select></label>
      </form>
      {message && <p role="status">{message}</p>}
      <div className="export-grid">
        <a className="export-card" href={apiExportUrl('monthly-expenses.xls', query)}>
          <strong>تقرير شهري Excel</strong><span>مصروفات الفسحة للطلاب جاهزة للفتح في Excel والطباعة.</span>
        </a>
        <a className="export-card" href={apiExportUrl('monthly-expenses-print', query)} target="_blank" rel="noreferrer">
          <strong>تقرير شهري PDF</strong><span>يفتح تقرير طباعة؛ اختر طباعة ثم حفظ كـ PDF.</span>
        </a>
        <a className="export-card" href={apiExportUrl('transactions.csv', query)}>
          <strong>تصدير العمليات</strong><span>كل عمليات الشهر المحدد بصيغة CSV.</span>
        </a>
        <a className="export-card" href={`/api/v1/exports/students.csv${schoolQuery}`}>
          <strong>تصدير الطلاب</strong><span>بيانات الطلاب ورصيد الفسحة ورمز البطاقة النشطة.</span>
        </a>
        <a className="export-card" href={apiExportUrl('canteen-accounting.csv', query)}>
          <strong>تقرير مطابقة المقصف</strong><span>المستحقات الحالية، الاسترجاعات، التسويات السابقة، والمتبقي للمحاسبة.</span>
        </a>
      </div>
    </AdminShell>
  );
}
