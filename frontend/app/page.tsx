'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from './components/AdminShell';
import { apiFetch } from './lib/api';

type Period = 'today' | 'week' | 'month' | 'custom';
type School = { id: string; name: string; schoolCode: string };
type DaySpend = { date: string; amount: string; count: number; percentage: number };
type RankedStudent = { studentId: string; fullName: string; studentCode: string; schoolName: string; count: number; amount: string };
type RankedSchool = { schoolId: string; schoolName: string; schoolCode: string; count: number; amount: string };
type AlertAction = { id: string; type: string; severity: 'danger' | 'warn' | 'info'; title: string; description: string; metric: string | number; href: string };
type ActivityItem = { id: string; action: string; entity: string; entityId: string; schoolName?: string | null; userEmail: string; timestamp: string };
type Dashboard = {
  schools: number;
  students: number;
  walletBalance: string;
  todayTransactions: number;
  periodTransactions: number;
  todaySpent: string;
  weekSpent: string;
  monthSpent: string;
  periodSpent: string;
  revokedCards: number;
  alertsCount: number;
  spendingByDay: DaySpend[];
  topStudents: RankedStudent[];
  topSchools: RankedSchool[];
  quickAlerts: {
    lowBalances: { studentId?: string; studentName: string; studentCode: string; schoolName: string; balance: string }[];
    dailyLimitReached: { studentId?: string; studentName: string; studentCode: string; schoolName: string; spentToday: string; dailyLimit: string }[];
    failedLogins: number;
    repeatedRefunds: number;
    revokedAttempts: number;
    actionItems?: AlertAction[];
  };
  canteen: { unsettledTotal: string; canteensWithDue: number };
  recentActivity: ActivityItem[];
};

const periodLabels: Record<Period, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر', custom: 'الفترة المختارة' };
const todayInputValue = () => new Date().toISOString().slice(0, 10);
const activityLabels: Record<string, string> = {
  STUDENT_CREATED: 'إضافة طالب',
  STUDENTS_IMPORTED: 'استيراد طلاب',
  STUDENT_UPDATED: 'تعديل طالب',
  STUDENT_TRANSFERRED: 'نقل طالب',
  WALLET_TOP_UP: 'تخصيص مبلغ فسحة',
  BULK_WALLET_TOP_UP: 'تخصيص مبالغ جماعي',
  CARD_REVOKED: 'إلغاء بطاقة',
  CARD_ISSUED: 'إصدار بطاقة',
  CANTEEN_SETTLED: 'تسوية مقصف',
  SYSTEM_BACKUP_CREATED: 'نسخة احتياطية'
};

export default function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [period, setPeriod] = useState<Period>('today');
  const [schoolId, setSchoolId] = useState('');
  const [startDate, setStartDate] = useState(todayInputValue);
  const [endDate, setEndDate] = useState(todayInputValue);
  const [message, setMessage] = useState('');

  const load = async (nextPeriod = period, nextSchoolId = schoolId, nextStartDate = startDate, nextEndDate = endDate) => {
    const query = new URLSearchParams({
      period: nextPeriod,
      ...(nextSchoolId ? { schoolId: nextSchoolId } : {}),
      ...(nextPeriod === 'custom' ? { startDate: nextStartDate, endDate: nextEndDate } : {})
    });
    const [dashboardResponse, schoolsResponse] = await Promise.all([
      apiFetch(`/dashboard?${query}`),
      apiFetch('/schools')
    ]);

    if (dashboardResponse.status === 401 || schoolsResponse.status === 401) return location.assign('/login');
    if (!dashboardResponse.ok) return setMessage('تتطلب لوحة الإدارة حساب مدير أو مدقق.');

    const schoolData: { schools?: School[] } = await schoolsResponse.json();
    setSchools(Array.isArray(schoolData.schools) ? schoolData.schools : []);
    setData(await dashboardResponse.json());
    setMessage('');
  };

  useEffect(() => { void load('today', '', startDate, endDate); }, []);

  const selectedSchoolName = useMemo(() => schools.find(school => school.id === schoolId)?.name ?? 'كل المدارس', [schoolId, schools]);
  const stats = data ? [
    ['إجمالي رصيد الفسحة المتاح', `${data.walletBalance} ر.س`],
    ['مصروف اليوم', `${data.todaySpent} ر.س`],
    ['مصروف هذا الأسبوع', `${data.weekSpent} ر.س`],
    ['مصروف هذا الشهر', `${data.monthSpent} ر.س`],
    ['الطلاب النشطون', data.students],
    ['البطاقات الملغاة', data.revokedCards],
    ['التنبيهات الحالية', data.alertsCount]
  ] : [];

  function changePeriod(nextPeriod: Period) {
    setPeriod(nextPeriod);
    void load(nextPeriod, schoolId, startDate, endDate);
  }

  function changeSchool(nextSchoolId: string) {
    setSchoolId(nextSchoolId);
    void load(period, nextSchoolId, startDate, endDate);
  }

  function changeStartDate(nextStartDate: string) {
    setStartDate(nextStartDate);
    if (period === 'custom') void load(period, schoolId, nextStartDate, endDate);
  }

  function changeEndDate(nextEndDate: string) {
    setEndDate(nextEndDate);
    if (period === 'custom') void load(period, schoolId, startDate, nextEndDate);
  }

  return (
    <AdminShell>
      <header className="dashboard-hero">
        <div>
          <strong>لوحة إدارة المصروف المدرسي</strong>
          <span>وضع اليوم أولًا، ثم مؤشرات الشهر والتنبيهات التي تحتاج إجراء.</span>
        </div>
        <div className="dashboard-filters">
          <label>الفترة
            <select value={period} onChange={event => changePeriod(event.target.value as Period)}>
              <option value="today">اليوم</option>
              <option value="week">الأسبوع</option>
              <option value="month">الشهر</option>
              <option value="custom">فترة مخصصة</option>
            </select>
          </label>
          {period === 'custom' && <>
            <label>من تاريخ
              <input type="date" value={startDate} max={endDate} onChange={event => changeStartDate(event.target.value)} />
            </label>
            <label>إلى تاريخ
              <input type="date" value={endDate} min={startDate} onChange={event => changeEndDate(event.target.value)} />
            </label>
          </>}
          <label>المدرسة
            <select value={schoolId} onChange={event => changeSchool(event.target.value)}>
              <option value="">كل المدارس</option>
              {schools.map(school => <option key={school.id} value={school.id}>{school.name} — {school.schoolCode}</option>)}
            </select>
          </label>
        </div>
      </header>

      {message && <p role="status">{message}</p>}

      <section className="dashboard-section">
        <div className="section-title">
          <h2>وضع اليوم</h2>
          <span>{selectedSchoolName}</span>
        </div>
        <div className="cards dashboard-cards">{stats.map(([label, value]) => <article key={String(label)}><small>{label}</small><b>{value}</b></article>)}</div>
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <h2>مصروف آخر 7 أيام</h2>
          <span>يساعدك تلاحظ الارتفاع المفاجئ بسرعة</span>
        </div>
        <div className="chart-card">
          {data?.spendingByDay.map(day => (
            <div className="bar-item" key={day.date}>
              <span>{new Date(day.date).toLocaleDateString('ar-SA', { weekday: 'short' })}</span>
              <div className="bar-track"><i style={{ height: `${Math.max(8, day.percentage)}%` }} /></div>
              <strong>{day.amount}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-section">
        <div className="section-title">
          <h2>مؤشرات {periodLabels[period]}</h2>
          <span>مصروف الفترة: {data?.periodSpent ?? '0.00'} ر.س — العمليات: {data?.periodTransactions ?? 0}</span>
        </div>
        <div className="two-columns">
          <article className="panel">
            <h3>أكثر 5 مدارس نشاطًا</h3>
            <table><thead><tr><th>المدرسة</th><th>العمليات</th><th>المصروف</th></tr></thead><tbody>{data?.topSchools.map(school => <tr key={school.schoolId}><td>{school.schoolName}<br /><small>{school.schoolCode}</small></td><td>{school.count}</td><td>{school.amount} ر.س</td></tr>)}</tbody></table>
          </article>
          <article className="panel">
            <h3>أكثر 5 طلاب استخدامًا</h3>
            <table><thead><tr><th>الطالب</th><th>المدرسة</th><th>العمليات</th><th>المصروف</th></tr></thead><tbody>{data?.topStudents.map(student => <tr key={student.studentId}><td>{student.fullName}<br /><small>{student.studentCode}</small></td><td>{student.schoolName}</td><td>{student.count}</td><td>{student.amount} ر.س</td></tr>)}</tbody></table>
          </article>
        </div>
      </section>

      <section className="dashboard-section">
        <div className="two-columns">
          <article className="panel action-alerts">
            <div className="section-title compact">
              <h2>تنبيهات تحتاج إجراء</h2>
              <a href="/alerts">عرض كل التنبيهات ←</a>
            </div>
            {data?.quickAlerts.actionItems?.slice(0, 6).map(item => (
              <a className={`alert-action ${item.severity}`} href={item.href} key={item.id}>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <b>{item.metric}</b>
              </a>
            ))}
            {!data?.quickAlerts.actionItems?.length && data?.quickAlerts.lowBalances.slice(0, 3).map(item => <p key={`${item.studentCode}-${item.schoolName}`}>رصيد فسحة منخفض: {item.studentName} — {item.balance} ر.س</p>)}
            {!data?.quickAlerts.actionItems?.length && data?.quickAlerts.dailyLimitReached.slice(0, 3).map(item => <p key={`${item.studentCode}-${item.schoolName}`}>وصل الحد اليومي: {item.studentName} — {item.spentToday}/{item.dailyLimit} ر.س</p>)}
            {!data?.quickAlerts.actionItems?.length && !!data?.quickAlerts.failedLogins && <p>محاولات دخول فاشلة كثيرة: {data.quickAlerts.failedLogins}</p>}
            {!data?.quickAlerts.actionItems?.length && !!data?.quickAlerts.repeatedRefunds && <p>استرجاعات متكررة: {data.quickAlerts.repeatedRefunds}</p>}
            {!data?.quickAlerts.actionItems?.length && !!data?.quickAlerts.revokedAttempts && <p>محاولات بطاقة ملغاة: {data.quickAlerts.revokedAttempts}</p>}
            {data && data.alertsCount === 0 && <p className="empty-state">لا توجد تنبيهات حاليًا.</p>}
          </article>

          <article className="panel canteen-overview">
            <h2>ملخص مستحقات المقصف</h2>
            <div className="canteen-number">
              <small>مستحقات المقاصف على الجمعية</small>
              <strong>{data?.canteen.unsettledTotal ?? '0.00'} ر.س</strong>
            </div>
            <p>عدد المقاصف التي عليها مبالغ: <strong>{data?.canteen.canteensWithDue ?? 0}</strong></p>
            <a href="/canteen-settlements">تسوية المقصف ←</a>
          </article>
        </div>
      </section>

      <section className="panel quick-actions">
        <h2>إجراءات سريعة</h2>
        <a href="/students">إضافة طالب ←</a>
        <a href="/wallets">تخصيص مبلغ فسحة ←</a>
        <a href="/cards">طباعة البطاقات ←</a>
        <a href="/exports">تصدير تقرير شهري ←</a>
        <a href="/canteen-users">إنشاء حساب مقصف ←</a>
      </section>

      <section className="panel">
        <div className="section-title compact">
          <h2>آخر نشاطات الإدارة</h2>
          <a href="/audit-logs">السجل الكامل ←</a>
        </div>
        <div className="activity-feed">
          {data?.recentActivity?.map(item => (
            <article key={item.id}>
              <strong>{activityLabels[item.action] ?? item.action}</strong>
              <span>{item.userEmail} {item.schoolName ? `— ${item.schoolName}` : ''}</span>
              <small>{new Date(item.timestamp).toLocaleString('ar-SA')}</small>
            </article>
          ))}
          {!data?.recentActivity?.length && <p className="empty-state">لا توجد نشاطات إدارية حديثة.</p>}
        </div>
      </section>
    </AdminShell>
  );
}
