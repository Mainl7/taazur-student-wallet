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
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = async () => {
      const response = await apiFetch('/audit-logs');
      if (response.status === 401) return location.assign('/login');
      if (!response.ok) return setMessage('هذا الحساب لا يملك صلاحية عرض سجل التدقيق.');

      const data: { logs?: AuditLog[] } = await response.json();
      setLogs(Array.isArray(data.logs) ? data.logs : []);
    };
    void load();
  }, []);

  return (
    <AdminShell>
      <header><div><h1>سجل التدقيق</h1><a href="/transactions">← سجل العمليات</a></div></header>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الوقت</th><th>الإجراء</th><th>الكيان</th><th>المدرسة</th><th>المستخدم</th><th>IP</th><th>قبل</th><th>بعد</th></tr></thead>
        <tbody>{logs.map(log => <tr key={log.id}><td>{new Date(log.timestamp).toLocaleString('ar-SA')}</td><td>{labels[log.action] ?? log.action}</td><td>{log.entity}<br /><small>{log.entityId}</small></td><td>{log.school ? `${log.school.name} — ${log.school.schoolCode}` : '—'}</td><td>{log.user?.email ?? 'النظام'}</td><td className="token">{log.ip ?? '—'}</td><td className="token">{pretty(log.oldValue)}</td><td className="token">{pretty(log.newValue)}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
