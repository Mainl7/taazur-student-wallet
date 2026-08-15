'use client';

import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Student = { id: string; fullName: string; studentCode: string; wallet: { balance: string; currency: string } | null };

export default function Wallets() {
  const [students, setStudents] = useState<Student[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const response = await apiFetch('/students');
    if (response.status === 401) return location.assign('/login');
    const data: { students?: Student[] } = await response.json();
    setStudents(Array.isArray(data.students) ? data.students : []);
  };

  useEffect(() => { void load(); }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
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

  return (
    <AdminShell>
      <header><div><h1>شحن المحافظ</h1><a href="/students">← الطلاب</a></div></header>
      <form className="entry" onSubmit={submit}>
        <select name="studentId" required defaultValue="">
          <option value="" disabled>اختر الطالب</option>
          {students.map(student => <option key={student.id} value={student.id}>{student.fullName} — {student.studentCode}</option>)}
        </select>
        <input name="amount" type="number" min="0.01" step="0.01" placeholder="قيمة الشحن بالريال" required />
        <button>شحن الرصيد</button>
      </form>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الطالب</th><th>الرمز</th><th>الرصيد الحالي</th></tr></thead>
        <tbody>{students.map(student => <tr key={student.id}><td>{student.fullName}</td><td>{student.studentCode}</td><td>{student.wallet ? `${student.wallet.balance} ${student.wallet.currency}` : '—'}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
