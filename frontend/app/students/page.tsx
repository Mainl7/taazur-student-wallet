'use client';
import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import Barcode from '../components/Barcode';

type School = { id: string; name: string };
type Student = { id: string; studentCode: string; fullName: string; grade: string; dailyLimit: string; schoolId: string; school: { name: string }; wallet: { balance: string; currency: string } | null; cards: { publicToken: string }[] };
const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export default function Students() {
  const [schools, setSchools] = useState<School[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [editing, setEditing] = useState<Student | null>(null);
  const [message, setMessage] = useState('');
  const authHeaders = () => ({ authorization: `Bearer ${localStorage.getItem('taazur_token')}` });
  const load = async () => {
    const headers = authHeaders();
    const [a, b] = await Promise.all([fetch(`${api}/schools`, { headers }), fetch(`${api}/students`, { headers })]);
    if (a.status === 401) return location.assign('/login');
    const schoolData: { schools?: School[] } = await a.json();
    const studentData: { students?: Student[] } = await b.json();
    setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
    setStudents(Array.isArray(studentData.students) ? studentData.students : []);
  };
  useEffect(() => { void load(); }, []);
  async function createStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await fetch(`${api}/students`, { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    if (!response.ok) return setMessage('تعذر إضافة الطالب.');
    form.reset();
    setMessage('تمت إضافة الطالب وبطاقته ومحفظته.');
    void load();
  }
  async function updateStudent(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = e.currentTarget;
    const response = await fetch(`${api}/students/${editing.id}`, { method: 'PATCH', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const data: { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر تعديل الطالب: ${data.error ?? 'UNKNOWN_ERROR'}`);
    setEditing(null);
    setMessage('تم تعديل بيانات الطالب والحد اليومي بدون تغيير سجل العمليات السابقة.');
    void load();
  }
  return <AdminShell><header><div><h1>الطلاب</h1><a href="/schools">← المدارس</a></div></header><form className="entry students" onSubmit={createStudent}><input name="studentCode" placeholder="رمز الطالب" required /><input name="fullName" placeholder="الاسم الكامل" required /><input name="grade" placeholder="الصف" required /><input name="dailyLimit" type="number" step="0.01" placeholder="الحد اليومي" required /><select name="schoolId" required defaultValue=""><option value="" disabled>اختر المدرسة</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button>إضافة طالب</button></form>{editing && <form className="entry students edit-box" onSubmit={updateStudent}><input name="studentCode" defaultValue={editing.studentCode} placeholder="رمز الطالب" required /><input name="fullName" defaultValue={editing.fullName} placeholder="الاسم الكامل" required /><input name="grade" defaultValue={editing.grade} placeholder="الصف" required /><input name="dailyLimit" defaultValue={editing.dailyLimit} type="number" step="0.01" placeholder="الحد اليومي" required /><select name="schoolId" required defaultValue={editing.schoolId}><option value="" disabled>اختر المدرسة</option>{schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button>حفظ التعديل</button><button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button></form>}{message && <p role="status">{message}</p>}<table><thead><tr><th>الرمز</th><th>الطالب</th><th>الصف</th><th>المدرسة</th><th>الحد اليومي</th><th>الرصيد</th><th>باركود البطاقة</th><th>الإجراء</th></tr></thead><tbody>{students.map(s => <tr key={s.id}><td>{s.studentCode}</td><td>{s.fullName}</td><td>{s.grade}</td><td>{s.school.name}</td><td>{s.dailyLimit} ر.س</td><td>{s.wallet ? `${s.wallet.balance} ${s.wallet.currency}` : '—'}</td><td>{s.cards[0]?.publicToken ? <Barcode value={s.cards[0].publicToken} /> : '—'}</td><td><button type="button" onClick={() => setEditing(s)}>تعديل</button></td></tr>)}</tbody></table></AdminShell>;
}
