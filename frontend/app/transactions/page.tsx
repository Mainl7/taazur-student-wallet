'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Transaction = { id: string; studentId: string; reference: string; amount: string; type: 'CREDIT' | 'DEBIT' | 'REFUND' | 'REVERSAL' | 'ADJUSTMENT'; balanceBefore: string; balanceAfter: string; createdAt: string; school: { name: string }; canteen?: { id: string; name: string } | null; student?: { fullName: string; studentCode: string }; performedBy: { email: string } };
type Totals = { type: string; _sum: { amount: string | null } };
type School = { id: string; name: string; schoolCode: string };
type Student = { id: string; fullName: string; studentCode: string };
type Canteen = { id: string; name: string; school: { name: string } };
const labels: Record<string, string> = { CREDIT: 'تخصيص فسحة', DEBIT: 'صرف مقصف', REFUND: 'استرجاع', REVERSAL: 'عكس', ADJUSTMENT: 'تعديل' };

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState<Totals[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [filter, setFilter] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [canteenId, setCanteenId] = useState('');
  const [reference, setReference] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [message, setMessage] = useState('');

  const load = async (type = filter) => {
    const query = new URLSearchParams({
      ...(type ? { type } : {}),
      ...(schoolId ? { schoolId } : {}),
      ...(studentId ? { studentId } : {}),
      ...(canteenId ? { canteenId } : {}),
      ...(reference ? { reference } : {}),
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    });
    const queryText = query.toString();
    const response = await apiFetch(`/transactions${queryText ? `?${queryText}` : ''}`);
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) {
      setMessage('هذا الحساب لا يملك صلاحية عرض التقارير.');
      return;
    }

    const data: { transactions?: Transaction[]; totals?: Totals[] } = await response.json();
    setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    setTotals(Array.isArray(data.totals) ? data.totals : []);
  };

  useEffect(() => {
    const boot = async () => {
      const [schoolsResponse, studentsResponse, canteensResponse] = await Promise.all([apiFetch('/schools'), apiFetch('/students'), apiFetch('/canteens')]);
      if (schoolsResponse.status === 401) return location.assign('/login');
      const schoolData: { schools?: School[] } = await schoolsResponse.json();
      const studentData: { students?: Student[] } = await studentsResponse.json();
      const canteenData: { canteens?: Canteen[] } = await canteensResponse.json().catch(() => ({}));
      setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
      setStudents(Array.isArray(studentData.students) ? studentData.students : []);
      setCanteens(Array.isArray(canteenData.canteens) ? canteenData.canteens : []);
      await load('');
    };
    void boot();
  }, []);

  async function refund(transaction: Transaction) {
    const reason = prompt('سبب الاسترجاع؟ مثال: خطأ في المبلغ أو إلغاء طلب')?.trim();
    if (!reason) return setMessage('سبب الاسترجاع مطلوب لحفظ سجل واضح.');
    if (!confirm(`استرجاع عملية صرف فسحة ${transaction.amount} ر.س للطالب ${transaction.student?.fullName ?? transaction.studentId}؟`)) return;

    const response = await apiFetch(`/transactions/${transaction.id}/refund`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر الاسترجاع: ${data.error ?? 'UNKNOWN_ERROR'}`);

    setMessage('تم استرجاع العملية وإعادة المبلغ لرصيد الفسحة.');
    void load();
  }

  const refundedReferences = useMemo(
    () => new Set(transactions.filter(transaction => transaction.type === 'REFUND' && transaction.reference.startsWith('REFUND-')).map(transaction => transaction.reference.replace('REFUND-', ''))),
    [transactions]
  );
  const totalText = useMemo(() => totals.map(total => `${labels[total.type] ?? total.type}: ${total._sum.amount ?? 0} ر.س`).join(' — '), [totals]);
  function exportCurrent() {
    const rows = [
      ['الوقت', 'الطالب', 'المدرسة', 'المقصف', 'النوع', 'المبلغ', 'رصيد الفسحة قبل', 'رصيد الفسحة بعد', 'المستخدم', 'رقم العملية'],
      ...transactions.map(transaction => [new Date(transaction.createdAt).toLocaleString('ar-SA'), transaction.student?.fullName ?? transaction.studentId, transaction.school.name, transaction.canteen?.name ?? '—', labels[transaction.type], transaction.amount, transaction.balanceBefore, transaction.balanceAfter, transaction.performedBy.email, transaction.reference])
    ];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'taazur-current-transactions.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AdminShell>
      <header><div><h1>سجل العمليات</h1><a href="/wallets">← تخصيص مبالغ الفسحة</a> <a href="/audit-logs">سجل التدقيق ←</a></div></header>
      <div className="report-tools filter-panel">
        <label>نوع العملية<select value={filter} onChange={event => { setFilter(event.target.value); void load(event.target.value); }}>
          <option value="">الكل</option><option value="CREDIT">تخصيص فسحة</option><option value="DEBIT">صرف مقصف</option><option value="REFUND">استرجاع</option>
        </select></label>
        <label>المدرسة<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">كل المدارس</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label>الطالب<select value={studentId} onChange={event => setStudentId(event.target.value)}><option value="">كل الطلاب</option>{students.map(student => <option key={student.id} value={student.id}>{student.fullName} — {student.studentCode}</option>)}</select></label>
        <label>المقصف<select value={canteenId} onChange={event => setCanteenId(event.target.value)}><option value="">كل المقاصف</option>{canteens.map(canteen => <option key={canteen.id} value={canteen.id}>{canteen.name} — {canteen.school.name}</option>)}</select></label>
        <label>رقم العملية<input value={reference} onChange={event => setReference(event.target.value)} placeholder="ابحث بالمرجع" /></label>
        <label>من تاريخ<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <button type="button" onClick={() => void load()}>تطبيق الفلاتر</button>
        <button type="button" className="secondary" onClick={exportCurrent} disabled={!transactions.length}>تصدير النتائج</button>
        <strong>{totalText}</strong>
      </div>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الوقت</th><th>الطالب</th><th>المدرسة</th><th>المقصف</th><th>النوع</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>المستخدم</th><th>رقم العملية</th><th>الإجراء</th></tr></thead>
        <tbody>{transactions.map(transaction => <tr key={transaction.id}><td>{new Date(transaction.createdAt).toLocaleString('ar-SA')}</td><td>{transaction.student?.fullName ?? transaction.studentId}</td><td>{transaction.school.name}</td><td>{transaction.canteen?.name ?? '—'}</td><td>{labels[transaction.type]}</td><td>{transaction.amount} ر.س</td><td>{transaction.balanceBefore}</td><td>{transaction.balanceAfter}</td><td>{transaction.performedBy.email}</td><td className="token">{transaction.reference}</td><td>{transaction.type === 'DEBIT' ? refundedReferences.has(transaction.id) ? 'تم الاسترجاع' : <button onClick={() => void refund(transaction)}>استرجاع</button> : '—'}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
