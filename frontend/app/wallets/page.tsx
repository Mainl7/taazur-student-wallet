'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; status: string };
type Student = {
  id: string;
  fullName: string;
  studentCode: string;
  schoolId: string;
  school: { name: string };
  wallet: { balance: string; currency: string } | null;
};

type BulkResponse = { batch?: { count: number; amountPerStudent: string; totalAmount: string }; error?: string };

export default function Wallets() {
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const activeSchools = useMemo(() => schools.filter(school => school.status === 'ACTIVE'), [schools]);
  const schoolStudents = useMemo(
    () => students.filter(student => !selectedSchoolId || student.schoolId === selectedSchoolId),
    [students, selectedSchoolId]
  );
  const selectedSchool = useMemo(
    () => schools.find(school => school.id === selectedSchoolId),
    [schools, selectedSchoolId]
  );

  const load = async () => {
    const [studentsResponse, schoolsResponse] = await Promise.all([
      apiFetch('/students'),
      apiFetch('/schools')
    ]);

    if (studentsResponse.status === 401 || schoolsResponse.status === 401) return location.assign('/login');

    const studentData: { students?: Student[] } = await studentsResponse.json();
    const schoolData: { schools?: School[] } = await schoolsResponse.json();
    const nextStudents = Array.isArray(studentData.students) ? studentData.students : [];
    const nextSchools = Array.isArray(schoolData.schools) ? schoolData.schools : [];

    setStudents(nextStudents);
    setSchools(nextSchools);
    setSelectedSchoolId(current => current || nextSchools.find(school => school.status === 'ACTIVE')?.id || '');
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    setSelectedStudentIds(ids => ids.filter(id => schoolStudents.some(student => student.id === id)));
  }, [schoolStudents]);

  async function submitSingle(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await apiFetch('/wallets/top-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    if (!response.ok) return setMessage('تعذر شحن المحفظة.');

    form.reset();
    setMessage('تم شحن المحفظة وتسجيل العملية في دفتر الأستاذ.');
    void load();
  }

  async function submitBulk(e: FormEvent<HTMLFormElement>, mode: 'school' | 'selected') {
    e.preventDefault();
    const form = e.currentTarget;
    const amount = String(new FormData(form).get('amount') ?? '');

    if (!selectedSchoolId) return setMessage('اختر المدرسة أولًا.');
    if (mode === 'selected' && selectedStudentIds.length === 0) return setMessage('حدد طالبًا واحدًا على الأقل.');
    if (mode === 'school' && !confirm(`سيتم شحن ${schoolStudents.length} طالب/طالبة في ${selectedSchool?.name ?? 'المدرسة المختارة'}. هل أنت متأكد؟`)) return;

    const response = await apiFetch('/wallets/bulk-top-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        amount,
        ...(mode === 'selected' ? { studentIds: selectedStudentIds } : {})
      })
    });
    const data: BulkResponse = await response.json();

    if (!response.ok) return setMessage(`تعذر الشحن الجماعي: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setSelectedStudentIds([]);
    setMessage(`تم شحن ${data.batch!.count} طالب/طالبة — إجمالي الشحن ${data.batch!.totalAmount} ر.س.`);
    void load();
  }

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds(ids => ids.includes(studentId) ? ids.filter(id => id !== studentId) : [...ids, studentId]);
  };

  const selectAllSchoolStudents = () => setSelectedStudentIds(schoolStudents.map(student => student.id));
  const clearSelectedStudents = () => setSelectedStudentIds([]);

  return (
    <AdminShell>
      <header>
        <div>
          <h1>شحن المحافظ</h1>
          <span>شحن فردي أو جماعي حسب المدرسة والطلاب المحددين</span>
        </div>
        <a href="/transactions">سجل العمليات ←</a>
      </header>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>شحن طالب واحد</h2>
          <span>مناسب للحالات السريعة</span>
        </div>
        <form className="entry" onSubmit={submitSingle}>
          <select name="studentId" required defaultValue="">
            <option value="" disabled>اختر الطالب</option>
            {students.map(student => <option key={student.id} value={student.id}>{student.fullName} — {student.studentCode} — {student.school.name}</option>)}
          </select>
          <input name="amount" type="number" min="0.01" step="0.01" placeholder="قيمة الشحن بالريال" required />
          <button>شحن الرصيد</button>
        </form>
      </section>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>الشحن الجماعي</h2>
          <span>اختر مدرسة كاملة أو طلابًا محددين من المدرسة</span>
        </div>

        <div className="panel bulk-wallet-panel">
          <label>
            المدرسة
            <select value={selectedSchoolId} onChange={event => { setSelectedSchoolId(event.target.value); setSelectedStudentIds([]); }}>
              <option value="">اختر المدرسة</option>
              {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
            </select>
          </label>

          <div className="bulk-actions">
            <form className="mini-form" onSubmit={event => void submitBulk(event, 'school')}>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="مبلغ لكل طالب" required />
              <button disabled={!selectedSchoolId || schoolStudents.length === 0}>شحن كل طلاب المدرسة</button>
            </form>

            <form className="mini-form" onSubmit={event => void submitBulk(event, 'selected')}>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="مبلغ لكل طالب محدد" required />
              <button disabled={!selectedSchoolId || selectedStudentIds.length === 0}>شحن الطلاب المحددين ({selectedStudentIds.length})</button>
            </form>
          </div>

          <div className="row-actions">
            <button type="button" className="secondary" onClick={selectAllSchoolStudents} disabled={!selectedSchoolId || schoolStudents.length === 0}>تحديد كل طلاب المدرسة</button>
            <button type="button" className="secondary" onClick={clearSelectedStudents} disabled={selectedStudentIds.length === 0}>مسح التحديد</button>
          </div>
        </div>
      </section>

      {message && <p role="status">{message}</p>}

      <table>
        <thead>
          <tr>
            <th>تحديد</th>
            <th>الطالب</th>
            <th>الرمز</th>
            <th>المدرسة</th>
            <th>الرصيد الحالي</th>
          </tr>
        </thead>
        <tbody>
          {schoolStudents.map(student => (
            <tr key={student.id}>
              <td><input type="checkbox" checked={selectedStudentIds.includes(student.id)} onChange={() => toggleStudent(student.id)} /></td>
              <td>{student.fullName}</td>
              <td>{student.studentCode}</td>
              <td>{student.school.name}</td>
              <td>{student.wallet ? `${student.wallet.balance} ${student.wallet.currency}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>
  );
}
