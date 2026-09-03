'use client';

import { FormEvent, useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; name: string; schoolCode: string; status: string };
type Manager = {
  id: string;
  email: string;
  status: string;
  createdAt: string;
  school: { id: string; name: string; schoolCode: string } | null;
};

export default function SchoolManagersPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [managers, setManagers] = useState<Manager[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [schoolsResponse, managersResponse] = await Promise.all([
      apiFetch('/schools'),
      apiFetch('/school-managers')
    ]);
    if (schoolsResponse.status === 401 || managersResponse.status === 401) return location.assign('/login');
    const schoolData: { schools?: School[] } = await schoolsResponse.json();
    const managerData: { managers?: Manager[]; error?: string } = await managersResponse.json();
    if (!managersResponse.ok) return setMessage(`تعذر تحميل مدراء المدارس: ${managerData.error ?? 'UNKNOWN_ERROR'}`);
    setSchools((schoolData.schools ?? []).filter(school => school.status === 'ACTIVE'));
    setManagers(managerData.managers ?? []);
  };

  useEffect(() => { void load(); }, []);

  async function createManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await apiFetch('/school-managers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data: { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر إنشاء حساب مدير المدرسة: ${data.error ?? 'UNKNOWN_ERROR'}`);
    form.reset();
    setMessage('تم إنشاء حساب مدير المدرسة وربطه بالمدرسة المحددة.');
    void load();
  }

  async function resetPassword(manager: Manager) {
    const password = window.prompt(`اكتب كلمة مرور جديدة لحساب ${manager.email}\nيفضل 12 حرفًا أو أكثر.`);
    if (!password) return;
    const response = await apiFetch(`/school-managers/${manager.id}/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data: { error?: string } = await response.json();
    if (!response.ok) return setMessage(`تعذر تغيير كلمة المرور: ${data.error ?? 'UNKNOWN_ERROR'}`);
    setMessage('تم تغيير كلمة مرور مدير المدرسة.');
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>مدراء المدارس</h1>
          <span>إنشاء حساب متابعة لمدير مدرسة محددة بدون صلاحيات تعديل.</span>
        </div>
        <button onClick={load}>تحديث</button>
      </header>

      {message && <p role="status">{message}</p>}

      <form className="entry" onSubmit={createManager}>
        <label>بريد مدير المدرسة
          <input name="email" type="email" required placeholder="manager@school.sa" />
        </label>
        <label>كلمة المرور
          <input name="password" type="password" required minLength={12} placeholder="12 حرف أو أكثر" />
        </label>
        <label>المدرسة
          <select name="schoolId" required defaultValue="">
            <option value="" disabled>اختر المدرسة</option>
            {schools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
          </select>
        </label>
        <button type="submit">إنشاء الحساب</button>
        <p className="form-note">عند دخول مدير المدرسة، سيتم تحويله تلقائيًا إلى واجهة متابعة مدرسته فقط.</p>
      </form>

      <h2>الحسابات المسجلة</h2>
      <table>
        <thead>
          <tr>
            <th>البريد</th>
            <th>المدرسة</th>
            <th>الحالة</th>
            <th>تاريخ الإنشاء</th>
            <th>الإجراء</th>
          </tr>
        </thead>
        <tbody>
          {managers.map(manager => (
            <tr key={manager.id}>
              <td>{manager.email}</td>
              <td>{manager.school ? `${manager.school.name} — ${manager.school.schoolCode}` : 'غير محدد'}</td>
              <td>{manager.status}</td>
              <td>{new Date(manager.createdAt).toLocaleString('ar-SA')}</td>
              <td><button className="secondary" onClick={() => resetPassword(manager)}>تغيير كلمة المرور</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </AdminShell>
  );
}
