'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; name: string; schoolCode: string };

const currentMonth = new Date().toISOString().slice(0, 7);

function fallbackFileName(path: string, month: string) {
  if (path.includes('students.csv')) return 'taazur-students.csv';
  if (path.includes('transactions.csv')) return `taazur-transactions-${month}.csv`;
  if (path.includes('monthly-expenses.xls')) return `taazur-monthly-${month}.xls`;
  return `taazur-report-${month}.html`;
}

function fileNameFromHeaders(response: Response, fallback: string) {
  const disposition = response.headers.get('content-disposition') ?? '';
  const match = disposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function ExportsPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [month, setMonth] = useState(currentMonth);
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState('');
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

  async function exportFile(path: string, label: string, openInNewTab = false) {
    setMessage('');
    setExporting(label);
    try {
      const response = await apiFetch(path);
      if (response.status === 401) return location.assign('/login');
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setMessage(`تعذر ${label}: ${data.error ?? 'EXPORT_FAILED'}`);
        return;
      }
      const blob = await response.blob();
      const fileName = fileNameFromHeaders(response, fallbackFileName(path, month));
      if (openInNewTab) {
        window.open(URL.createObjectURL(blob), '_blank', 'noopener,noreferrer');
        return;
      }
      downloadBlob(blob, fileName);
      setMessage(`تم تجهيز ${label}.`);
    } finally {
      setExporting('');
    }
  }

  return (
    <AdminShell>
      <header><div><h1>التصدير والطباعة</h1><span>ملفات للمدرسة أو لكل المدارس حسب صلاحية الحساب</span></div></header>
      <form className="entry">
        <label>الشهر<input type="month" value={month} onChange={event => setMonth(event.target.value)} /></label>
        <label>المدرسة<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">كل المدارس</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}</select></label>
      </form>
      {message && <p role="status">{message}</p>}
      <div className="export-grid">
        <button type="button" className="export-card" disabled={!!exporting} onClick={() => void exportFile(`/exports/monthly-expenses.xls?${query}`, 'تقرير Excel')}>
          <strong>تقرير شهري Excel</strong><span>مصروفات الطلاب جاهزة للفتح في Excel والطباعة.</span>
        </button>
        <button type="button" className="export-card" disabled={!!exporting} onClick={() => void exportFile(`/exports/monthly-expenses-print?${query}`, 'تقرير PDF', true)}>
          <strong>تقرير شهري PDF</strong><span>يفتح تقرير طباعة؛ اختر طباعة ثم حفظ كـ PDF.</span>
        </button>
        <button type="button" className="export-card" disabled={!!exporting} onClick={() => void exportFile(`/exports/transactions.csv?${query}`, 'تصدير العمليات')}>
          <strong>{exporting === 'تصدير العمليات' ? 'جاري تجهيز العمليات...' : 'تصدير العمليات'}</strong><span>كل عمليات الشهر المحدد بصيغة CSV.</span>
        </button>
        <button type="button" className="export-card" disabled={!!exporting} onClick={() => void exportFile(`/exports/students.csv${schoolQuery}`, 'تصدير الطلاب')}>
          <strong>{exporting === 'تصدير الطلاب' ? 'جاري تجهيز الطلاب...' : 'تصدير الطلاب'}</strong><span>بيانات الطلاب والرصيد ورمز البطاقة النشطة.</span>
        </button>
      </div>
    </AdminShell>
  );
}
