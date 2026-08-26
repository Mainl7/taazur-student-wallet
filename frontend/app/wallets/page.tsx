'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; status: string };
type Student = {
  id: string;
  fullName: string;
  studentCode: string;
  grade: string;
  schoolId: string;
  school: { name: string };
  wallet: { balance: string; currency: string } | null;
};

type BulkResponse = { batch?: { count: number; amountPerStudent: string; totalAmount: string }; error?: string };
const formDataValue = (form: HTMLFormElement, key: string) => String(new FormData(form).get(key) ?? '');

export default function Wallets() {
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState('');
  const [singleStudentId, setSingleStudentId] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [selectedGrade, setSelectedGrade] = useState('');
  const [bulkAmount, setBulkAmount] = useState('');
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
  const schoolGrades = useMemo(() => [...new Set(schoolStudents.map(student => student.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true })), [schoolStudents]);
  const gradeStudents = useMemo(() => selectedGrade ? schoolStudents.filter(student => student.grade === selectedGrade) : [], [schoolStudents, selectedGrade]);
  const previewCount = selectedStudentIds.length || gradeStudents.length || schoolStudents.length;
  const previewTotal = bulkAmount ? (Number(bulkAmount) * previewCount).toFixed(2) : '0.00';

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
    const requestedStudentId = new URLSearchParams(location.search).get('studentId') ?? '';
    if (requestedStudentId && nextStudents.some(student => student.id === requestedStudentId)) setSingleStudentId(requestedStudentId);
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

    if (!response.ok) return setMessage('تعذر تخصيص مبلغ الفسحة.');

    form.reset();
    setMessage('تم تخصيص مبلغ الفسحة من الجمعية وتسجيل العملية في دفتر الأستاذ.');
    void load();
  }

  async function submitBulk(e: FormEvent<HTMLFormElement>, mode: 'school' | 'grade' | 'selected') {
    e.preventDefault();
    const form = e.currentTarget;
    const amount = String(new FormData(form).get('amount') ?? '');

    if (!selectedSchoolId) return setMessage('اختر المدرسة أولًا.');
    if (mode === 'selected' && selectedStudentIds.length === 0) return setMessage('حدد طالبًا واحدًا على الأقل.');
    if (mode === 'grade' && !selectedGrade) return setMessage('اختر الصف أولًا.');
    if (mode === 'school' && !confirm(`سيتم تخصيص مبلغ فسحة لـ ${schoolStudents.length} طالب/طالبة في ${selectedSchool?.name ?? 'المدرسة المختارة'}. هل أنت متأكد؟`)) return;

    const response = await apiFetch('/wallets/bulk-top-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        amount,
        reason: formDataValue(form, 'reason'),
        ...(mode === 'grade' ? { grade: selectedGrade } : {}),
        ...(mode === 'selected' ? { studentIds: selectedStudentIds } : {})
      })
    });
    const data: BulkResponse = await response.json();

    if (!response.ok) return setMessage(`تعذر التخصيص الجماعي: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setSelectedStudentIds([]);
    setMessage(`تم تخصيص مبلغ فسحة لـ ${data.batch!.count} طالب/طالبة — إجمالي المخصص ${data.batch!.totalAmount} ر.س.`);
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
          <h1>تخصيص مبالغ الفسحة</h1>
          <span>اعتماد مبالغ الفسحة من الجمعية لطالب واحد أو مجموعة طلاب</span>
        </div>
        <a href="/transactions">سجل العمليات ←</a>
      </header>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>تخصيص لطالب واحد</h2>
          <span>مناسب للحالات السريعة</span>
        </div>
        <form className="entry" onSubmit={submitSingle}>
          <select name="studentId" required value={singleStudentId} onChange={event => setSingleStudentId(event.target.value)}>
            <option value="" disabled>اختر الطالب</option>
            {students.map(student => <option key={student.id} value={student.id}>{student.fullName} — {student.studentCode} — {student.school.name}</option>)}
          </select>
          <input name="amount" type="number" min="0.01" step="0.01" placeholder="قيمة مخصص الفسحة بالريال" required />
          <select name="reason" defaultValue="شهري">
            <option value="شهري">شهري</option>
            <option value="إضافي">إضافي</option>
            <option value="دعم خاص">دعم خاص</option>
            <option value="تصحيح">تصحيح</option>
          </select>
          <button>اعتماد المبلغ</button>
        </form>
      </section>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>التخصيص الجماعي</h2>
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
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="مبلغ فسحة لكل طالب" required onChange={event => setBulkAmount(event.target.value)} />
              <select name="reason" defaultValue="شهري"><option value="شهري">شهري</option><option value="إضافي">إضافي</option><option value="دعم خاص">دعم خاص</option><option value="تصحيح">تصحيح</option></select>
              <button disabled={!selectedSchoolId || schoolStudents.length === 0}>تخصيص لكل طلاب المدرسة</button>
            </form>

            <form className="mini-form" onSubmit={event => void submitBulk(event, 'grade')}>
              <select value={selectedGrade} onChange={event => setSelectedGrade(event.target.value)}>
                <option value="">اختر الصف</option>
                {schoolGrades.map(grade => <option key={grade} value={grade}>{grade}</option>)}
              </select>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="مبلغ فسحة لكل طالب في الصف" required onChange={event => setBulkAmount(event.target.value)} />
              <select name="reason" defaultValue="شهري"><option value="شهري">شهري</option><option value="إضافي">إضافي</option><option value="دعم خاص">دعم خاص</option><option value="تصحيح">تصحيح</option></select>
              <button disabled={!selectedSchoolId || !selectedGrade || gradeStudents.length === 0}>تخصيص الصف ({gradeStudents.length})</button>
            </form>

            <form className="mini-form" onSubmit={event => void submitBulk(event, 'selected')}>
              <input name="amount" type="number" min="0.01" step="0.01" placeholder="مبلغ فسحة لكل طالب محدد" required onChange={event => setBulkAmount(event.target.value)} />
              <select name="reason" defaultValue="شهري"><option value="شهري">شهري</option><option value="إضافي">إضافي</option><option value="دعم خاص">دعم خاص</option><option value="تصحيح">تصحيح</option></select>
              <button disabled={!selectedSchoolId || selectedStudentIds.length === 0}>تخصيص للطلاب المحددين ({selectedStudentIds.length})</button>
            </form>
          </div>

          <p className="form-note">معاينة الاعتماد: {previewCount} طالب/طالبة — إجمالي تقريبي {previewTotal} ر.س.</p>

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
            <th>رصيد الفسحة المتاح</th>
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
