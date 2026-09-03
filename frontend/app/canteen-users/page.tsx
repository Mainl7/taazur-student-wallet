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

type ActionKey = 'cashier' | 'owner' | 'canteen' | 'auditor';
type TableKey = 'canteens' | 'owners' | 'cashiers' | 'auditors';

export default function CanteenUsers() {
  const [schools, setSchools] = useState<School[]>([]);
  const [users, setUsers] = useState<CanteenUser[]>([]);
  const [canteens, setCanteens] = useState<Array<Canteen & { operator: { id: string; email: string } }>>([]);
  const [resetUser, setResetUser] = useState<CanteenUser | null>(null);
  const [activeAction, setActiveAction] = useState<ActionKey>('cashier');
  const [activeTable, setActiveTable] = useState<TableKey>('canteens');
  const [message, setMessage] = useState('');

  const activeSchools = useMemo(() => schools.filter(school => school.status === 'ACTIVE'), [schools]);
  const cashierUsers = useMemo(() => users.filter(user => user.role === 'CANTEEN_CASHIER' || (user.role === 'CANTEEN_OPERATOR' && !!user.school)), [users]);
  const ownerUsers = useMemo(() => users.filter(user => user.role === 'CANTEEN_OWNER' || (user.role === 'CANTEEN_OPERATOR' && !user.school)), [users]);
  const auditorUsers = useMemo(() => users.filter(user => user.role === 'AUDITOR'), [users]);

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

  async function createAuditorAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (!body.schoolId) delete body.schoolId;

    const response = await apiFetch('/canteen-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, role: 'AUDITOR' })
    });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر إنشاء حساب المدقق: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    setMessage('تم إنشاء حساب مدقق/مشاهد فقط. يستطيع الاطلاع على البيانات والتقارير بدون تعديل.');
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

  const actionCards: Array<{ key: ActionKey; title: string; text: string; stat: string }> = [
    { key: 'cashier', title: 'حساب كاشير', text: 'يرتبط بمدرسة واحدة ويدخل شاشة المحاسبة فقط.', stat: String(cashierUsers.length) },
    { key: 'owner', title: 'حساب مالك', text: 'لا يرتبط بمدرسة؛ تضيف له المقاصف التابعة له.', stat: String(ownerUsers.length) },
    { key: 'canteen', title: 'إضافة مقصف', text: 'اربط المقصف بمدرسة، ثم اختر مالكه.', stat: String(canteens.length) },
    { key: 'auditor', title: 'مشاهد فقط', text: 'للمراجعة والتقارير بدون إضافة أو تعديل.', stat: String(auditorUsers.length) }
  ];

  const tableTabs: Array<{ key: TableKey; label: string; count: number }> = [
    { key: 'canteens', label: 'المقاصف', count: canteens.length },
    { key: 'owners', label: 'ملاك المقاصف', count: ownerUsers.length },
    { key: 'cashiers', label: 'الكاشير', count: cashierUsers.length },
    { key: 'auditors', label: 'المشاهدين', count: auditorUsers.length }
  ];

  const resetLabel = resetUser?.role === 'AUDITOR' ? 'حساب المدقق' : resetUser?.school ? 'حساب الكاشير' : 'مالك المقصف';

  return (
    <AdminShell>
      <header>
        <div>
          <h1>ملاك المقاصف</h1>
          <span>إدارة حسابات الكاشير، ملاك المقاصف، وربط كل مقصف بمدرسته ومالكه</span>
        </div>
        <a href="/canteen-owner">واجهة مالك المقصف ←</a>
      </header>

      <section className="dashboard-section canteen-admin-guide">
        <article>
          <strong>الترتيب الصحيح</strong>
          <span>1) أنشئ حساب مالك المقصف عند الحاجة. 2) أضف المقصف واربطه بمدرسة ومالك. 3) أنشئ حساب كاشير للمدرسة التي تتم فيها المحاسبة.</span>
        </article>
        <article>
          <strong>تنبيه مهم</strong>
          <span>حتى لو كان المالك واحدًا لمدرستين، اجعل لكل مدرسة مقصفًا مستقلًا حتى تبقى التسويات والتقارير صحيحة.</span>
        </article>
      </section>

      <section className="dashboard-section">
        <div className="canteen-action-grid">
          {actionCards.map(action => (
            <button
              className={`action-choice ${activeAction === action.key ? 'active' : ''}`}
              key={action.key}
              type="button"
              onClick={() => setActiveAction(action.key)}
            >
              <b>{action.stat}</b>
              <strong>{action.title}</strong>
              <span>{action.text}</span>
            </button>
          ))}
        </div>

        <div className="panel canteen-action-panel">
          {activeAction === 'cashier' && (
            <>
              <div className="section-title compact">
                <h2>إنشاء حساب كاشير مقصف</h2>
                <span>هذا الحساب يدخل شاشة المحاسبة فقط، ويرتبط بمدرسة واحدة.</span>
              </div>
              <form className="entry" onSubmit={createCashierAccount}>
                <label>بريد الكاشير
                  <input name="email" type="email" placeholder="cashier@taazur.sa" autoComplete="off" required />
                </label>
                <label>كلمة المرور
                  <input name="password" type="password" minLength={12} placeholder="12 حرف أو أكثر" autoComplete="new-password" required />
                </label>
                <label>المدرسة
                  <select name="schoolId" required defaultValue="">
                    <option value="" disabled>اختر المدرسة</option>
                    {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
                  </select>
                </label>
                <button>إنشاء حساب الكاشير</button>
              </form>
            </>
          )}

          {activeAction === 'owner' && (
            <>
              <div className="section-title compact">
                <h2>إنشاء حساب مالك مقصف</h2>
                <span>حساب المالك يشاهد المقاصف التابعة له والمصاريف والتسويات، ولا يدخل شاشة الكاشير.</span>
              </div>
              <form className="entry" onSubmit={createOwnerAccount}>
                <label>بريد مالك المقصف
                  <input name="email" type="email" placeholder="owner@company.sa" autoComplete="off" required />
                </label>
                <label>كلمة المرور
                  <input name="password" type="password" minLength={12} placeholder="12 حرف أو أكثر" autoComplete="new-password" required />
                </label>
                <button>إنشاء حساب المالك</button>
                <p className="form-note">بعد إنشاء الحساب، انتقل إلى “إضافة مقصف” واربط المقاصف بهذا المالك.</p>
              </form>
            </>
          )}

          {activeAction === 'canteen' && (
            <>
              <div className="section-title compact">
                <h2>إضافة مقصف وربطه بمالك</h2>
                <span>المقصف يرتبط بمدرسة واحدة، ويمكن للمالك الواحد امتلاك أكثر من مقصف.</span>
              </div>
              <form className="entry" onSubmit={createCanteen}>
                <label>اسم المقصف
                  <input name="name" placeholder="مثال: مقصف ابتدائية السداد" required />
                </label>
                <label>رمز المقصف
                  <input name="canteenCode" placeholder="اختياري" />
                </label>
                <label>المدرسة
                  <select name="schoolId" required defaultValue="">
                    <option value="" disabled>اختر المدرسة</option>
                    {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
                  </select>
                </label>
                <label>مالك المقصف
                  <select name="operatorId" required defaultValue="">
                    <option value="" disabled>اختر مالك المقصف</option>
                    {ownerUsers.map(user => <option key={user.id} value={user.id}>{user.email}</option>)}
                  </select>
                </label>
                <button>إضافة المقصف</button>
              </form>
            </>
          )}

          {activeAction === 'auditor' && (
            <>
              <div className="section-title compact">
                <h2>إنشاء حساب مدقق / مشاهد فقط</h2>
                <span>هذا الحساب يراجع التقارير والسجلات بدون صلاحية إضافة أو تعديل.</span>
              </div>
              <form className="entry" onSubmit={createAuditorAccount}>
                <label>بريد المدقق
                  <input name="email" type="email" placeholder="auditor@taazur.sa" autoComplete="off" required />
                </label>
                <label>كلمة المرور
                  <input name="password" type="password" minLength={12} placeholder="12 حرف أو أكثر" autoComplete="new-password" required />
                </label>
                <label>نطاق المدرسة
                  <select name="schoolId" defaultValue="">
                    <option value="">كل المدارس حسب صلاحية المدير</option>
                    {activeSchools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
                  </select>
                </label>
                <button>إنشاء حساب مدقق</button>
              </form>
            </>
          )}
        </div>
      </section>

      {message && <p role="status">{message}</p>}

      {resetUser && (
        <section className="dashboard-section">
          <div className="section-title compact">
            <h2>تغيير كلمة مرور {resetLabel}</h2>
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

      <section className="dashboard-section">
        <div className="section-title">
          <div>
            <h2>السجلات</h2>
            <span>اختر الجدول الذي تريد مراجعته بدل عرض كل الجداول مرة واحدة</span>
          </div>
        </div>
        <div className="table-tabs">
          {tableTabs.map(tab => (
            <button className={activeTable === tab.key ? 'active' : ''} key={tab.key} type="button" onClick={() => setActiveTable(tab.key)}>
              {tab.label}
              <b>{tab.count}</b>
            </button>
          ))}
        </div>

        {activeTable === 'canteens' && (
          <table>
            <thead><tr><th>المقصف</th><th>الرمز</th><th>المدرسة</th><th>مالك المقصف</th><th>الحالة</th></tr></thead>
            <tbody>{canteens.map(canteen => <tr key={canteen.id}><td><a className="table-link" href={`/canteens/${canteen.id}`}>{canteen.name}</a></td><td>{canteen.canteenCode ?? '—'}</td><td>{canteen.school.name}<br /><small>{canteen.school.schoolCode}</small></td><td>{canteen.operator.email}</td><td>{canteen.status}</td></tr>)}</tbody>
          </table>
        )}

        {activeTable === 'owners' && (
          <table>
            <thead><tr><th>البريد</th><th>المقاصف التابعة</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
            <tbody>
              {ownerUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.operatedCanteens.length ? user.operatedCanteens.map(canteen => `${canteen.name} (${canteen.school.name})`).join('، ') : 'لم تتم إضافة مقاصف بعد'}</td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}
              {!ownerUsers.length && <tr><td colSpan={4}>لا توجد حسابات ملاك مقاصف حتى الآن.</td></tr>}
            </tbody>
          </table>
        )}

        {activeTable === 'cashiers' && (
          <table>
            <thead><tr><th>البريد</th><th>المدرسة المرتبط بها</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
            <tbody>
              {cashierUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.school?.name}<br /><small>{user.school?.schoolCode}</small></td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}
              {!cashierUsers.length && <tr><td colSpan={4}>لا توجد حسابات مقصف/كاشير حتى الآن.</td></tr>}
            </tbody>
          </table>
        )}

        {activeTable === 'auditors' && (
          <table>
            <thead><tr><th>البريد</th><th>نطاق المدرسة</th><th>تاريخ الإنشاء</th><th>الإجراء</th></tr></thead>
            <tbody>
              {auditorUsers.map(user => <tr key={user.id}><td>{user.email}</td><td>{user.school ? <>{user.school.name}<br /><small>{user.school.schoolCode}</small></> : 'كل المدارس'}</td><td>{new Date(user.createdAt).toLocaleString('ar-SA')}</td><td><button type="button" onClick={() => setResetUser(user)}>تغيير كلمة المرور</button></td></tr>)}
              {!auditorUsers.length && <tr><td colSpan={4}>لا توجد حسابات مدققين حتى الآن.</td></tr>}
            </tbody>
          </table>
        )}
      </section>
    </AdminShell>
  );
}
