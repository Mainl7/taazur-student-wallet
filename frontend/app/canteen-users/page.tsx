'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; status: string };
type Canteen = { id: string; name: string; canteenCode?: string | null; status: string; school: { name: string; schoolCode: string } };
type CanteenUser = {
  id: string;
  email: string;
  createdAt: string;
  school: { name: string; schoolCode: string } | null;
  operatedCanteens: Canteen[];
};

export default function CanteenUsers() {
  const [schools, setSchools] = useState<School[]>([]);
  const [users, setUsers] = useState<CanteenUser[]>([]);
  const [canteens, setCanteens] = useState<Array<Canteen & { operator: { id: string; email: string } }>>([]);
  const [resetUser, setResetUser] = useState<CanteenUser | null>(null);
  const [message, setMessage] = useState('');

  const activeSchools = useMemo(() => schools.filter(school => school.status === 'ACTIVE'), [schools]);

  const load = async () => {
    const [schoolResponse, userResponse, canteenResponse] = await Promise.all([apiFetch('/schools'), apiFetch('/canteen-users'), apiFetch('/canteens')]);
    if (schoolResponse.status === 401 || userResponse.status === 401 || canteenResponse.status === 401) return location.assign('/login');
    if (!userResponse.ok) return setMessage('هذا الحساب لا يملك صلاحية إدارة حسابات المقصف.');

    const schoolData: { schools?: School[] } = await schoolResponse.json();
    const userData: { users?: CanteenUser[] } = await userResponse.json();
    const canteenData: { canteens?: Array<Canteen & { operator: { id: string; email: string } }> } = await canteenResponse.json();
    setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
    setUsers(Array.isArray(userData.users) ? userData.users : []);
    setCanteens(Array.isArray(canteenData.canteens) ? canteenData.canteens : []);
  };

  useEffect(() => { void load(); }, []);

  async function createUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.schoolId) delete body.schoolId;

    const response = await apiFetch('/canteen-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر إنشاء الحساب: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setMessage('تم إنشاء حساب مشغّل المقصف. أضف له مقصفًا أو أكثر من النموذج التالي.');
    void load();
  }

  async function createCanteen(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.canteenCode) delete body.canteenCode;

    const response = await apiFetch('/canteens', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر إضافة المقصف: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setMessage('تم إضافة المقصف وربطه بالمشغّل والمدرسة.');
    void load();
  }

  async function resetPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resetUser) return;
    const form = e.currentTarget;
    const password = String(new FormData(form).get('password') ?? '');

    const response = await apiFetch(`/canteen-users/${resetUser.id}/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر تغيير كلمة المرور: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setResetUser(null);
    setMessage(`تم تغيير كلمة مرور ${resetUser.email}. يمكنه تسجيل الدخول بكلمة المرور الجديدة الآن.`);
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>ملاك المقاصف</h1>
          <span>أنشئ حساب مالك المقصف، ثم اربط تحته المقاصف التابعة له والمدرسة الخاصة بكل مقصف</span>
        </div>
        <a href="/canteen-owner">واجهة مالك المقصف ←</a>
      </header>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>إنشاء حساب مالك مقصف</h2>
          <span>الحساب لا يرتبط بمدرسة مباشرة؛ الربط يتم من خلال المقاصف التابعة له</span>
        </div>
        <form className="entry" onSubmit={createUser}>
          <input name="email" type="email" placeholder="بريد مالك المقصف" autoComplete="off" required />
          <input name="password" type="password" minLength={12} placeholder="كلمة مرور 12 حرف أو أكثر" autoComplete="new-password" required />
          <button>إنشاء الحساب</button>
        </form>
      </section>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>إضافة مقصف تابع لمالك</h2>
          <span>اختر المدرسة التي يخدمها المقصف، ثم اختر مالك المقصف</span>
        </div>
        <form className="entry" onSubmit={createCanteen}>
          <input name="name" placeholder="اسم المقصف" required />
          <input name="canteenCode" placeholder="رمز اختياري للمقصف" />
          <select name="schoolId" required defaultValue="">
            <option value="" disabled>اختر المدرسة</option>
            {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
          </select>
          <select name="operatorId" required defaultValue="">
            <option value="" disabled>اختر مالك المقصف</option>
            {users.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}
          </select>
          <button>إضافة المقصف</button>
        </form>
      </section>

      {message && <p role="status">{message}</p>}

      {resetUser && (
        <section className="dashboard-section">
          <div className="section-title compact">
            <h2>تغيير كلمة مرور مالك المقصف</h2>
            <span>لن تظهر كلمة المرور بعد الحفظ، وسيتم إزالة قفل محاولات الدخول الفاشلة لهذا الحساب</span>
          </div>
          <form className="entry" onSubmit={resetPassword}>
            <input value={resetUser.email} readOnly aria-label="حساب المشغّل" />
            <input name="password" type="password" minLength={12} placeholder="كلمة المرور الجديدة 12 حرف أو أكثر" autoComplete="new-password" required />
            <button>حفظ كلمة المرور الجديدة</button>
            <button type="button" className="secondary" onClick={() => setResetUser(null)}>إلغاء</button>
          </form>
        </section>
      )}

      <h2>المقاصف المسجلة</h2>
      <table>
        <thead><tr><th>المقصف</th><th>الرمز</th><th>المدرسة</th><th>مالك المقصف</th><th>الحالة</th></tr></thead>
        <tbody>{canteens.map(canteen => <tr key={canteen.id}><td>{canteen.name}</td><td>{canteen.canteenCode ?? '—'}</td><td>{canteen.school.name}<br /><small>{canteen.school.schoolCode}</small></td><td>{canteen.operator.email}</td><td>{canteen.status}</td></tr>)}</tbody>
      </table>

      <h2>حسابات ملاك المقاصف</h2>
      <table>
        <thead><tr><th>البريد</th><th>المقاصف التابعة</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
        <tbody>{users.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.operatedCanteens.length ? user.operatedCanteens.map(canteen => `${canteen.name} (${canteen.school.name})`).join('، ') : 'لم تتم إضافة مقاصف بعد'}</td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
