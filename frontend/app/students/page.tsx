'use client';

import { FormEvent, useEffect, useState } from 'react';
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
  schoolId: string;
  school: { name: string };
  wallet: { balance: string; currency: string } | null;
  cards: { publicToken: string }[];
};

export default function Students() {
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [editing, setEditing] = useState<Student | null>(null);
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
    setMessage('تمت إضافة الطالب وبطاقته ومحفظته.');
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

  const activeSchools = schools.filter(school => !school.status || school.status === 'ACTIVE');

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

      <table>
        <thead>
          <tr>
            <th>الرمز</th>
            <th>الطالب</th>
            <th>الصف</th>
            <th>المدرسة</th>
            <th>الحد اليومي</th>
            <th>الرصيد</th>
            <th>بطاقة QR</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {students.map(student => {
            const token = student.cards[0]?.publicToken;

            return (
              <tr key={student.id}>
                <td>{student.studentCode}</td>
                <td>{student.fullName}</td>
                <td>{student.grade}</td>
                <td>{student.school.name}</td>
                <td>{student.dailyLimit} ر.س</td>
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
                <td><button type="button" onClick={() => setEditing(student)}>تعديل</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </AdminShell>
  );
}
