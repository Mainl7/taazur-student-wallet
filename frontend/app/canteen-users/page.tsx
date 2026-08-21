'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type School = { id: string; schoolCode: string; name: string; status: string };
type Canteen = { id: string; name: string; canteenCode?: string | null; status: string; school: { name: string; schoolCode: string } };
type CanteenUser = {
  id: string;
  email: string;
  role: string;
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
  const cashierUsers = useMemo(() => users.filter(user => user.role === 'CANTEEN_CASHIER' || (user.role === 'CANTEEN_OPERATOR' && !!user.school)), [users]);
  const ownerUsers = useMemo(() => users.filter(user => user.role === 'CANTEEN_OWNER' || (user.role === 'CANTEEN_OPERATOR' && !user.school)), [users]);

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

  async function createCashierAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    const response = await apiFetch('/canteen-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر إنشاء الحساب: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setMessage('تم إنشاء حساب المقصف وربطه بالمدرسة. هذا الحساب يستخدم شاشة الكاشير فقط.');
    void load();
  }

  async function createOwnerAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));

    const response = await apiFetch('/canteen-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر إنشاء حساب المالك: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setMessage('تم إنشاء حساب مالك المقصف. اربط المقاصف التابعة له من نموذج إضافة المقصف.');
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
          <span>افصل بين حساب الكاشير المرتبط بمدرسة، وحساب المالك الذي تُضاف له المقاصف التابعة</span>
        </div>
        <a href="/canteen-owner">واجهة مالك المقصف ←</a>
      </header>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>إنشاء حساب للمقصف</h2>
          <span>هذا الحساب خاص بالكاشير، ويرتبط بمدرسة واحدة فقط لاستخدام شاشة المحاسبة</span>
        </div>
        <form className="entry" onSubmit={createCashierAccount}>
          <input name="email" type="email" placeholder="بريد حساب المقصف" autoComplete="off" required />
          <input name="password" type="password" minLength={12} placeholder="كلمة مرور 12 حرف أو أكثر" autoComplete="new-password" required />
          <select name="schoolId" required defaultValue="">
            <option value="" disabled>اختر المدرسة</option>
            {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
          </select>
          <button>إنشاء الحساب</button>
        </form>
      </section>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>إنشاء حساب مالك مقصف</h2>
          <span>حساب المالك لا يرتبط بمدرسة مباشرة؛ تضيف له المقاصف فقط</span>
        </div>
        <form className="entry" onSubmit={createOwnerAccount}>
          <input name="email" type="email" placeholder="بريد مالك المقصف" autoComplete="off" required />
          <input name="password" type="password" minLength={12} placeholder="كلمة مرور 12 حرف أو أكثر" autoComplete="new-password" required />
          <button>إنشاء حساب المالك</button>
        </form>
      </section>

      <section className="dashboard-section">
        <div className="section-title compact">
          <h2>إضافة مقصف تابع لمالك</h2>
          <span>اربط المقصف بمدرسته، ثم اختر مالك المقصف المسؤول عنه</span>
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
            {ownerUsers.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}
          </select>
          <button>إضافة المقصف</button>
        </form>
      </section>

      {message && <p role="status">{message}</p>}

      {resetUser && (
        <section className="dashboard-section">
          <div className="section-title compact">
            <h2>تغيير كلمة مرور {resetUser.school ? 'حساب المقصف' : 'مالك المقصف'}</h2>
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
        <tbody>{canteens.map(canteen => <tr key={canteen.id}><td><a className="table-link" href={`/canteens/${canteen.id}`}>{canteen.name}</a></td><td>{canteen.canteenCode ?? '—'}</td><td>{canteen.school.name}<br /><small>{canteen.school.schoolCode}</small></td><td>{canteen.operator.email}</td><td>{canteen.status}</td></tr>)}</tbody>
      </table>

      <h2>حسابات ملاك المقاصف</h2>
      <table>
        <thead><tr><th>البريد</th><th>المقاصف التابعة</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
        <tbody>
          {ownerUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.operatedCanteens.length ? user.operatedCanteens.map(canteen => `${canteen.name} (${canteen.school.name})`).join('، ') : 'لم تتم إضافة مقاصف بعد'}</td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}
          {!ownerUsers.length && <tr><td colSpan={4}>لا توجد حسابات ملاك مقاصف حتى الآن.</td></tr>}
        </tbody>
      </table>

      <h2>حسابات المقاصف / الكاشير</h2>
      <table>
        <thead><tr><th>البريد</th><th>المدرسة المرتبط بها</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
        <tbody>
          {cashierUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.school?.name}<br /><small>{user.school?.schoolCode}</small></td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}
          {!cashierUsers.length && <tr><td colSpan={4}>لا توجد حسابات مقصف/كاشير حتى الآن.</td></tr>}
        </tbody>
      </table>
    </AdminShell>
  );
}
