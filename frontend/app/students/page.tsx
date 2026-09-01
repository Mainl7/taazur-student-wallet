'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import Barcode from '../components/Barcode';
import { apiFetch } from '../lib/api';

type School = { id: string; name: string; status?: string };
type Student = {
  id: string;
  studentCode: string;
  fullName: string;
  grade: string;
  dailyLimit: string;
  status: string;
  schoolId: string;
  school: { name: string };
  wallet: { balance: string; currency: string } | null;
  cards: { publicToken: string }[];
};

type StudentSearchKey = 'studentCode' | 'fullName' | 'schoolName' | 'grade';

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase('ar-SA').replace(/\s+/g, ' ');
}

export default function Students() {
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [editing, setEditing] = useState<Student | null>(null);
  const [searchBy, setSearchBy] = useState<StudentSearchKey>('fullName');
  const [searchText, setSearchText] = useState('');
  const [filterSchoolId, setFilterSchoolId] = useState('');
  const [filterGrade, setFilterGrade] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [lowBalanceOnly, setLowBalanceOnly] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSchoolId, setImportSchoolId] = useState('');
  const [importText, setImportText] = useState('');
  const [importResults, setImportResults] = useState<Array<{ row: number; studentCode: string; status: string; message: string }>>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [schoolsResponse, studentsResponse] = await Promise.all([
      apiFetch('/schools'),
      apiFetch('/students')
    ]);

    if (schoolsResponse.status === 401) return location.assign('/login');

    const schoolData: { schools?: School[] } = await schoolsResponse.json();
    const studentData: { students?: Student[] } = await studentsResponse.json();
    setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
    setStudents(Array.isArray(studentData.students) ? studentData.students : []);
  };

  useEffect(() => { void load(); }, []);

  async function createStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await apiFetch('/students', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    if (!response.ok) return setMessage('تعذر إضافة الطالب.');

    form.reset();
    setMessage('تمت إضافة الطالب وبطاقته ورصيد الفسحة الخاص به.');
    void load();
  }

  async function updateStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;

    const form = e.currentTarget;
    const response = await apiFetch(`/students/${editing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر تعديل الطالب: ${data.error ?? 'UNKNOWN_ERROR'}`);

    setEditing(null);
    setMessage('تم تعديل بيانات الطالب. إذا تغيّرت المدرسة، تم نقل سجلاته المالية للمدرسة الجديدة.');
    void load();
  }

  function parseCsvLine(line: string) {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  }

  async function importStudents() {
    const lines = importText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (!lines.length) return setMessage('الصق بيانات CSV أولًا.');
    const hasHeader = /studentCode|رمز|اسم|fullName/i.test(lines[0]);
    const rows = lines.slice(hasHeader ? 1 : 0).map(line => {
      const [studentCode, fullName, grade, dailyLimit, schoolCode, className] = parseCsvLine(line);
      return { studentCode, fullName, grade, dailyLimit, schoolCode: schoolCode || undefined, className: className || undefined };
    });
    const response = await apiFetch('/students/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ defaultSchoolId: importSchoolId || undefined, rows })
    });
    const data: { createdCount?: number; totalRows?: number; results?: typeof importResults; error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) return setMessage(`تعذر استيراد الطلاب: ${data.error ?? 'تأكد من الأعمدة والبيانات'}`);
    setImportResults(Array.isArray(data.results) ? data.results : []);
    setMessage(`تم استيراد ${data.createdCount ?? 0} طالب من أصل ${data.totalRows ?? rows.length}.`);
    void load();
  }

  const activeSchools = schools.filter(school => !school.status || school.status === 'ACTIVE');
  const grades = useMemo(() => [...new Set(students.map(student => student.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true })), [students]);
  const visibleStudents = useMemo(() => {
    const valueOf = (student: Student) => {
      if (searchBy === 'schoolName') return student.school.name;
      return student[searchBy];
    };
    const query = normalizeSearch(searchText);
    return students
      .filter(student => !query || normalizeSearch(valueOf(student)).includes(query))
      .filter(student => !filterSchoolId || student.schoolId === filterSchoolId)
      .filter(student => !filterGrade || student.grade === filterGrade)
      .filter(student => !filterStatus || student.status === filterStatus)
      .filter(student => !lowBalanceOnly || Number(student.wallet?.balance ?? 0) < 10)
      .sort((a, b) => valueOf(a).localeCompare(valueOf(b), 'ar', { numeric: true, sensitivity: 'base' }));
  }, [filterGrade, filterSchoolId, filterStatus, lowBalanceOnly, searchBy, searchText, students]);

  return (
    <AdminShell>
      <header>
        <div>
          <h1>الطلاب</h1>
          <a href="/schools">← المدارس</a>
        </div>
      </header>

      <form className="entry students" onSubmit={createStudent}>
        <input name="studentCode" placeholder="رمز الطالب" required />
        <input name="fullName" placeholder="الاسم الكامل" required />
        <input name="grade" placeholder="الصف" required />
        <input name="dailyLimit" type="number" step="0.01" placeholder="الحد اليومي" required />
        <select name="schoolId" required defaultValue="">
          <option value="" disabled>اختر المدرسة</option>
          {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select>
        <button>إضافة طالب</button>
      </form>

      {editing && (
        <form className="entry students edit-box" onSubmit={updateStudent}>
          <input name="studentCode" defaultValue={editing.studentCode} placeholder="رمز الطالب" required />
          <input name="fullName" defaultValue={editing.fullName} placeholder="الاسم الكامل" required />
          <input name="grade" defaultValue={editing.grade} placeholder="الصف" required />
          <input name="dailyLimit" defaultValue={editing.dailyLimit} type="number" step="0.01" placeholder="الحد اليومي" required />
          <select name="status" required defaultValue={editing.status}>
            <option value="ACTIVE">نشط</option>
            <option value="SUSPENDED">موقوف</option>
            <option value="INACTIVE">مؤرشف</option>
          </select>
          <select name="schoolId" required defaultValue={editing.schoolId}>
            <option value="" disabled>اختر المدرسة</option>
            {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
          <button>حفظ التعديل</button>
          <button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button>
          <small className="form-note">عند نقل الطالب لمدرسة ثانية سيتم نقل عملياته المالية السابقة للمدرسة الجديدة حتى لا تتكرر الحسابات بين المدرستين.</small>
        </form>
      )}

      {message && <p role="status">{message}</p>}

      <section className="panel">
        <div className="section-title compact">
          <h2>استيراد الطلاب من Excel / CSV</h2>
          <button type="button" className="secondary" onClick={() => setImportOpen(!importOpen)}>{importOpen ? 'إخفاء الاستيراد' : 'فتح الاستيراد'}</button>
        </div>
        {importOpen && (
          <div className="import-box">
            <p>من Excel اختر “حفظ باسم CSV”، ثم الصق الأعمدة بهذا الترتيب: رمز الطالب، اسم الطالب، الصف، الحد اليومي، رمز المدرسة اختياري، الفصل اختياري.</p>
            <label>مدرسة افتراضية للطلاب
              <select value={importSchoolId} onChange={event => setImportSchoolId(event.target.value)}>
                <option value="">استخدام رمز المدرسة داخل CSV</option>
                {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
              </select>
            </label>
            <textarea value={importText} onChange={event => setImportText(event.target.value)} rows={7} placeholder={'studentCode,fullName,grade,dailyLimit,schoolCode,className\nSTU-001,محمد أحمد,أول ابتدائي,10,TAZ-001,أ'} />
            <div className="row-actions">
              <button type="button" onClick={() => void importStudents()}>استيراد الطلاب</button>
              <button type="button" className="secondary" onClick={() => { setImportText(''); setImportResults([]); }}>مسح</button>
            </div>
            {importResults.length > 0 && (
              <table>
                <thead><tr><th>السطر</th><th>رمز الطالب</th><th>الحالة</th><th>الملاحظة</th></tr></thead>
                <tbody>{importResults.slice(0, 20).map(result => <tr key={`${result.row}-${result.studentCode}`}><td>{result.row}</td><td>{result.studentCode}</td><td>{result.status}</td><td>{result.message}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <form className="entry student-tools">
        <label>
          البحث حسب
          <select value={searchBy} onChange={event => setSearchBy(event.target.value as StudentSearchKey)}>
            <option value="studentCode">الرمز</option>
            <option value="fullName">اسم الطالب</option>
            <option value="schoolName">المدرسة</option>
            <option value="grade">الصف</option>
          </select>
        </label>
        <label>
          بحث الطلاب
          <input value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="اكتب كلمة البحث..." />
        </label>
        <button type="button" className="secondary" onClick={() => setSearchText('')}>مسح البحث</button>
        <label>
          المدرسة
          <select value={filterSchoolId} onChange={event => setFilterSchoolId(event.target.value)}>
            <option value="">كل المدارس</option>
            {schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
          </select>
        </label>
        <label>
          الصف
          <select value={filterGrade} onChange={event => setFilterGrade(event.target.value)}>
            <option value="">كل الصفوف</option>
            {grades.map(grade => <option key={grade} value={grade}>{grade}</option>)}
          </select>
        </label>
        <label>
          الحالة
          <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
            <option value="">كل الحالات</option>
            <option value="ACTIVE">نشط</option>
            <option value="SUSPENDED">موقوف</option>
            <option value="INACTIVE">مؤرشف</option>
          </select>
        </label>
        <label className="check-control"><input type="checkbox" checked={lowBalanceOnly} onChange={event => setLowBalanceOnly(event.target.checked)} /> رصيد فسحة منخفض</label>
        <small className="form-note">النتائج: {visibleStudents.length} من {students.length}</small>
      </form>

      <table>
        <thead>
          <tr>
            <th>الرمز</th>
            <th>الطالب</th>
            <th>الصف</th>
            <th>المدرسة</th>
            <th>الحد اليومي</th>
            <th>الحالة</th>
            <th>رصيد الفسحة</th>
            <th>بطاقة QR</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {visibleStudents.map(student => {
            const token = student.cards[0]?.publicToken;

            return (
              <tr key={student.id}>
                <td>{student.studentCode}</td>
                <td>{student.fullName}</td>
                <td>{student.grade}</td>
                <td>{student.school.name}</td>
                <td>{student.dailyLimit} ر.س</td>
                <td>{student.status}</td>
                <td>{student.wallet ? `${student.wallet.balance} ${student.wallet.currency}` : '—'}</td>
                <td>
                  {token ? (
                    <Barcode
                      value={token}
                      studentName={student.fullName}
                      studentCode={student.studentCode}
                      schoolName={student.school.name}
                      fileName={`taazur-${student.studentCode}`}
                      downloadable
                    />
                  ) : '—'}
                </td>
                <td>
                  <div className="row-actions">
                    <a className="table-link" href={`/students/${student.id}`}>تفاصيل</a>
                    <a className="table-link" href={`/wallets?studentId=${student.id}`}>تخصيص فسحة</a>
                    <button type="button" onClick={() => setEditing(student)}>تعديل</button>
                  </div>
                </td>
              </tr>
            );
          })}
          {!visibleStudents.length && <tr><td colSpan={9}>لا توجد نتائج مطابقة للبحث.</td></tr>}
        </tbody>
      </table>
    </AdminShell>
  );
}
