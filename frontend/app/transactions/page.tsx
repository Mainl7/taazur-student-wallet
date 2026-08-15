'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import { apiFetch } from '../lib/api';

type Transaction = { id: string; studentId: string; reference: string; amount: string; type: 'CREDIT' | 'DEBIT' | 'REFUND' | 'REVERSAL' | 'ADJUSTMENT'; balanceBefore: string; balanceAfter: string; createdAt: string; school: { name: string }; student?: { fullName: string; studentCode: string }; performedBy: { email: string } };
type Totals = { type: string; _sum: { amount: string | null } };
const labels: Record<string, string> = { CREDIT: 'شحن', DEBIT: 'خصم', REFUND: 'استرجاع', REVERSAL: 'عكس', ADJUSTMENT: 'تعديل' };

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totals, setTotals] = useState<Totals[]>([]);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('');

  const load = async (type = filter) => {
    const query = type ? `?type=${type}` : '';
    const response = await apiFetch(`/transactions${query}`);
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) {
      setMessage('هذا الحساب لا يملك صلاحية عرض التقارير.');
      return;
    }

    const data: { transactions?: Transaction[]; totals?: Totals[] } = await response.json();
    setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    setTotals(Array.isArray(data.totals) ? data.totals : []);
  };

  useEffect(() => { void load(''); }, []);

  async function refund(transaction: Transaction) {
    if (!confirm(`استرجاع عملية خصم ${transaction.amount} ر.س للطالب ${transaction.student?.fullName ?? transaction.studentId}؟`)) return;

    const response = await apiFetch(`/transactions/${transaction.id}/refund`, { method: 'POST' });
    const data: { error?: string } = await response.json();

    if (!response.ok) return setMessage(`تعذر الاسترجاع: ${data.error ?? 'UNKNOWN_ERROR'}`);

    setMessage('تم استرجاع العملية وإعادة المبلغ للمحفظة.');
    void load();
  }

  const refundedReferences = useMemo(
    () => new Set(transactions.filter(transaction => transaction.type === 'REFUND' && transaction.reference.startsWith('REFUND-')).map(transaction => transaction.reference.replace('REFUND-', ''))),
    [transactions]
  );
  const totalText = useMemo(() => totals.map(total => `${labels[total.type] ?? total.type}: ${total._sum.amount ?? 0} ر.س`).join(' — '), [totals]);

  return (
    <AdminShell>
      <header><div><h1>سجل العمليات</h1><a href="/wallets">← شحن المحافظ</a> <a href="/audit-logs">سجل التدقيق ←</a></div></header>
      <div className="report-tools">
        <label>نوع العملية<select value={filter} onChange={event => { setFilter(event.target.value); void load(event.target.value); }}>
          <option value="">الكل</option><option value="CREDIT">شحن</option><option value="DEBIT">خصم</option><option value="REFUND">استرجاع</option>
        </select></label>
        <strong>{totalText}</strong>
      </div>
      {message && <p role="status">{message}</p>}
      <table>
        <thead><tr><th>الوقت</th><th>الطالب</th><th>المدرسة</th><th>النوع</th><th>المبلغ</th><th>قبل</th><th>بعد</th><th>المستخدم</th><th>الإجراء</th></tr></thead>
        <tbody>{transactions.map(transaction => <tr key={transaction.id}><td>{new Date(transaction.createdAt).toLocaleString('ar-SA')}</td><td>{transaction.student?.fullName ?? transaction.studentId}</td><td>{transaction.school.name}</td><td>{labels[transaction.type]}</td><td>{transaction.amount} ر.س</td><td>{transaction.balanceBefore}</td><td>{transaction.balanceAfter}</td><td>{transaction.performedBy.email}</td><td>{transaction.type === 'DEBIT' ? refundedReferences.has(transaction.id) ? 'تم الاسترجاع' : <button onClick={() => void refund(transaction)}>استرجاع</button> : '—'}</td></tr>)}</tbody>
      </table>
    </AdminShell>
  );
}
