'use client';

import { useEffect, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type AuditLog = { id: string; action: string; entity: string; entityId: string; oldValue: unknown; newValue: unknown; ip?: string | null; userAgent?: string | null; timestamp: string; user: { email: string } | null; school: { name: string; schoolCode: string } | null };
const labels: Record<string, string> = {
  AUTH_LOGIN: 'تسجيل دخول',
  SCHOOL_CREATED: 'إنشاء مدرسة',
  STUDENT_CREATED: 'إنشاء طالب',
  CARD_REVOKED: 'إلغاء بطاقة',
  CARD_ISSUED: 'إصدار بطاقة',
  WALLET_TOP_UP: 'تخصيص مبلغ فسحة',
  CANTEEN_DEBIT: 'صرف فسحة في المقصف',
  TRANSACTION_REFUNDED: 'استرجاع عملية',
  CANTEEN_USER_CREATED: 'إنشاء حساب مقصف',
  STUDENT_UPDATED: 'تعديل بيانات طالب'
};
const pretty = (value: unknown) => value ? JSON.stringify(value) : '—';

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [action, setAction] = useState('');
  const [entity, setEntity] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
      const query = new URLSearchParams({ ...(action ? { action } : {}), ...(entity ? { entity } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
      const response = await apiFetch(`/audit-logs${query.toString() ? `?${query}` : ''}`);
      if (response.status === 401) return location.assign('/login');
      if (!response.ok) return setMessage('هذا الحساب لا يملك صلاحية عرض سجل التدقيق.');

      const data: { logs?: AuditLog[] } = await response.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    };

  useEffect(() => { void load(); }, []);

  function exportLogs() {
    const query = new URLSearchParams({ ...(action ? { action } : {}), ...(entity ? { entity } : {}), ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) });
    location.assign(`/api/v1/audit-logs.csv${query.toString() ? `?${query}` : ''}`);
  }

  return (
    <AdminShell>
      <header><div><h1>سجل التدقيق</h1><a href="/transactions">← سجل العمليات</a></div></header>
      <form className="entry student-tools">
        <label>الإجراء<input value={action} onChange={event => setAction(event.target.value)} placeholder="مثال: STUDENT_UPDATED" /></label>
        <label>الكيان<input value={entity} onChange={event => setEntity(event.target.value)} placeholder="Student / School / WalletTransaction" /></label>
        <label>من تاريخ<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
        <label>إلى تاريخ<input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} /></label>
        <button type="button" onClick={() => void load()}>تطبيق الفلاتر</button>
        <button type="button" className="secondary" onClick={exportLogs}>تصدير السجل</button>
      </form>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الوقت</th><th>الإجراء</th><th>الكيان</th><th>المدرسة</th><th>المستخدم</th><th>IP</th><th>قبل</th><th>بعد</th></tr></thead>
        <tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.timestamp).toLocaleString('ar-SA')}</td><td>{labels[log.action] ?? log.action}</td><td>{log.entity}<br /><small>{log.entityId}</small></td><td>{log.school ? `${log.school.name} — ${log.school.schoolCode}` : '—'}</td><td>{log.user?.email ?? 'النظام'}</td><td className="token">{log.ip ?? '—'}</td><td className="token">{pretty(log.oldValue)}</td><td className="token">{pretty(log.newValue)}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
