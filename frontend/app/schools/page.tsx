'use client';

import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; city: string; status: string; _count: { students: number } };

export default function Schools() {
  const [schools, setSchools] = useState<School[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/schools');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) {
      setSchools([]);
      setMessage('هذا الحساب لا يملك صلاحية إدارة المدارس.');
      return;
    }
    const data: { schools?: School[] } = await response.json();
    setSchools(Array.isArray(data.schools) ? data.schools : []);
  };

  useEffect(() => { void load(); }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await apiFetch('/schools', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });

    if (!response.ok) return setMessage('تعذر حفظ المدرسة.');

    form.reset();
    setMessage('تمت إضافة المدرسة.');
    void load();
  }

  return (
    <AdminShell>
      <header><div><h1>المدارس</h1><a href="/students">إدارة الطلاب ←</a></div></header>
      <form className="entry" onSubmit={submit}>
        <input name="schoolCode" placeholder="رمز المدرسة" required />
        <input name="name" placeholder="اسم المدرسة" required />
        <input name="city" placeholder="المدينة" required />
        <input name="district" placeholder="الحي (اختياري)" />
        <button>إضافة مدرسة</button>
      </form>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الرمز</th><th>المدرسة</th><th>المدينة</th><th>الطلاب</th><th>الحالة</th></tr></thead>
        <tbody>{schools.map(school => <tr key={school.id}><td>{school.schoolCode}</td><td>{school.name}</td><td>{school.city}</td><td>{school._count.students}</td><td>{school.status}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
