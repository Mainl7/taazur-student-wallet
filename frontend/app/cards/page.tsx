'use client';

import { useEffect, useMemo, useState } from 'react';
import AdminShell from '../components/AdminShell';
import Barcode from '../components/Barcode';
import { apiFetch } from '../lib/api';

type Card = {
  id: string;
  publicToken: string;
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  issuedAt: string;
  revokedAt: string | null;
  student: {
    id: string;
    fullName: string;
    studentCode: string;
    grade: string;
    school: { id: string; name: string };
  };
};

export default function Cards() {
  const [cards, setCards] = useState<Card[]>([]);
  const [schoolId, setSchoolId] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [printMode, setPrintMode] = useState<'business' | 'a4' | 'labels'>('business');
  const [message, setMessage] = useState('');
  const activeStudentIds = useMemo(
    () => new Set(cards.filter(card => card.status === 'ACTIVE').map(card => card.student.id)),
    [cards]
  );
  const schools = useMemo(() => {
    const items = new Map<string, string>();
    cards.forEach(card => items.set(card.student.school.id, card.student.school.name));
    return [...items.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }, [cards]);
  const grades = useMemo(() => [...new Set(cards.map(card => card.student.grade).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar', { numeric: true })), [cards]);
  const visibleCards = useMemo(() => cards
    .filter(card => !schoolId || card.student.school.id === schoolId)
    .filter(card => !grade || card.student.grade === grade)
    .filter(card => !status || card.status === status), [cards, grade, schoolId, status]);

  const load = async () => {
    const response = await apiFetch('/cards');
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setMessage('هذا الحساب لا يملك صلاحية إدارة البطاقات.');

    const data: { cards?: Card[] } = await response.json();
    setCards(Array.isArray(data.cards) ? data.cards : []);
  };

  useEffect(() => { void load(); }, []);

  async function revoke(card: Card) {
    const reason = prompt('سبب إلغاء البطاقة؟')?.trim();
    if (!reason) return setMessage('سبب الإلغاء مطلوب.');
    if (!confirm(`إلغاء بطاقة ${card.student.fullName}؟`)) return;

    const response = await apiFetch(`/cards/${card.id}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) return setMessage('تعذر إلغاء البطاقة.');

    setMessage('تم إلغاء البطاقة. يمكنك إصدار بديل.');
    void load();
  }

  async function replace(card: Card) {
    const reason = prompt('سبب إصدار البطاقة البديلة؟')?.trim();
    if (!reason) return setMessage('سبب إصدار البطاقة البديلة مطلوب.');
    const response = await apiFetch(`/students/${card.student.id}/cards`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) return setMessage('تعذر إصدار بطاقة بديلة.');

    setMessage('تم إصدار بطاقة بديلة برمز جديد وآمن.');
    void load();
  }

  function testQr(card: Card) {
    setMessage(`اختبار QR: البطاقة النشطة تخص ${card.student.fullName} — ${card.student.studentCode}. جرّب مسحها من شاشة المقصف.`);
  }

  return (
    <AdminShell>
      <header>
        <div>
          <h1>البطاقات</h1>
          <a href="/students">← الطلاب</a>
        </div>
        <button type="button" onClick={() => print()}>طباعة البطاقات</button>
      </header>

      <form className="entry student-tools">
        <label>المدرسة<select value={schoolId} onChange={event => setSchoolId(event.target.value)}><option value="">كل المدارس</option>{schools.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label>الصف<select value={grade} onChange={event => setGrade(event.target.value)}><option value="">كل الصفوف</option>{grades.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>حالة البطاقة<select value={status} onChange={event => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="ACTIVE">النشطة فقط</option><option value="REVOKED">الملغاة</option><option value="EXPIRED">المنتهية</option></select></label>
        <label>مقاس الطباعة<select value={printMode} onChange={event => setPrintMode(event.target.value as typeof printMode)}><option value="business">بطاقة عمل</option><option value="a4">صفحة A4</option><option value="labels">ملصقات</option></select></label>
        <small className="form-note">البطاقات الجاهزة للطباعة: {visibleCards.length}</small>
      </form>

      {message && <p role="status">{message}</p>}

      <table className={`cards-print-table print-${printMode}`}>
        <thead>
          <tr>
            <th>الطالب</th>
            <th>المدرسة</th>
            <th>بطاقة QR</th>
            <th>الحالة</th>
            <th>تاريخ الإصدار</th>
            <th>الإجراءات</th>
          </tr>
        </thead>
        <tbody>
          {visibleCards.map(card => (
            <tr key={card.id}>
              <td>{card.student.fullName}<br /><small>{card.student.studentCode}</small></td>
              <td>{card.student.school.name}</td>
              <td>
                {card.status === 'ACTIVE' ? (
                  <Barcode
                    value={card.publicToken}
                    studentName={card.student.fullName}
                    studentCode={card.student.studentCode}
                    schoolName={card.student.school.name}
                    fileName={`taazur-${card.student.studentCode}`}
                    downloadable
                  />
                ) : <span className="token">{card.publicToken}</span>}
              </td>
              <td>{card.status}</td>
              <td>{new Date(card.issuedAt).toLocaleDateString('ar-SA')}</td>
              <td>
                {card.status === 'ACTIVE'
                  ? <><button onClick={() => testQr(card)}>اختبار QR</button><button onClick={() => void revoke(card)}>إلغاء</button></>
                  : !activeStudentIds.has(card.student.id)
                    ? <button onClick={() => void replace(card)}>إصدار بديل</button>
                    : 'تم الاستبدال'}
              </td>
            </tr>
          ))}
          {!visibleCards.length && <tr><td colSpan={6}>لا توجد بطاقات مطابقة للفلتر.</td></tr>}
        </tbody>
      </table>
    </AdminShell>
  );
}
