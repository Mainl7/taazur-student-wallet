'use client';

import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; city: string; district?: string | null; status: string; _count: { students: number } };

export default function Schools() {
  const [schools, setSchools] = useState<School[]>([]);
  const [editing, setEditing] = useState<School | null>(null);
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

  async function updateSchool(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;

    const form = e.currentTarget;
    const response = await apiFetch(`/schools/${editing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر تعديل المدرسة: ${data.error ?? 'UNKNOWN_ERROR'}`);

    setEditing(null);
    setMessage('تم تعديل بيانات المدرسة.');
    void load();
  }

  async function deactivateSchool(school: School) {
    if (!confirm(`تعطيل مدرسة ${school.name}؟ إذا كان لديها طلاب نشطون سيطلب النظام نقلهم أو تعطيلهم أولًا.`)) return;

    const response = await apiFetch(`/schools/${school.id}`, { method: 'DELETE' });
    const data: { error?: string } = await response.json();

    if (!response.ok) {
      const message = data.error === 'SCHOOL_HAS_ACTIVE_STUDENTS'
        ? 'لا يمكن تعطيل المدرسة وفيها طلاب نشطون. انقل الطلاب إلى مدرسة أخرى أولًا ثم حاول مرة ثانية.'
        : `تعذر تعطيل المدرسة: ${data.error ?? 'UNKNOWN_ERROR'}`;
      return setMessage(message);
    }

    setMessage('تم تعطيل المدرسة بشكل آمن، والسجلات المالية بقيت محفوظة.');
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
      {editing && (
        <form className="entry edit-box" onSubmit={updateSchool}>
          <input name="schoolCode" defaultValue={editing.schoolCode} placeholder="رمز المدرسة" required />
          <input name="name" defaultValue={editing.name} placeholder="اسم المدرسة" required />
          <input name="city" defaultValue={editing.city} placeholder="المدينة" required />
          <input name="district" defaultValue={editing.district ?? ''} placeholder="الحي (اختياري)" />
          <select name="status" required defaultValue={editing.status}>
            <option value="ACTIVE">نشطة</option>
            <option value="INACTIVE">غير نشطة</option>
            <option value="SUSPENDED">موقوفة</option>
          </select>
          <button>حفظ تعديل المدرسة</button>
          <button type="button" className="secondary" onClick={() => setEditing(null)}>إلغاء</button>
        </form>
      )}
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الرمز</th><th>المدرسة</th><th>المدينة</th><th>الحي</th><th>الطلاب</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
        <tbody>{schools.map(school => <tr key={school.id}><td>{school.schoolCode}</td><td>{school.name}</td><td>{school.city}</td><td>{school.district ?? '—'}</td><td>{school._count.students}</td><td>{school.status}</td><td className="row-actions"><button type="button" onClick={() => setEditing(school)}>تعديل</button><button type="button" className="danger-button" onClick={() => void deactivateSchool(school)} disabled={school.status !== 'ACTIVE'}>تعطيل</button></td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
