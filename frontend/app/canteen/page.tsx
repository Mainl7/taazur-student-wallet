'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { FormEvent, useEffect, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo';
import LogoutButton from '../components/LogoutButton';
import { apiFetch } from '../lib/api';

type MeResponse = { user?: { role: string; schoolId?: string | null }; error?: string };
type Notice = { text: string; tone: 'success' | 'error' | 'info' };
type LookupStudent = { id: string; fullName: string; studentCode: string; grade: string; schoolName: string; balance: string; dailyLimit: string; todaySpent: string; todayRemaining: string };
type Canteen = { id: string; name: string; canteenCode?: string | null; school: { name: string; schoolCode: string } };
type CanteenSummary = { debit: string; refund: string; net: string; transactionCount: number; periodStart: string; canteen?: { name: string } | null };
type DebitTransaction = { id: string; amount: string; balanceAfter: string; reference: string; student?: { fullName: string; studentCode: string }; canteen?: { name: string } | null };

const scannerHints = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]
  ],
  [DecodeHintType.TRY_HARDER, true]
]);

export default function Canteen() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lookup, setLookup] = useState<LookupStudent | null>(null);
  const [canteens, setCanteens] = useState<Canteen[]>([]);
  const [selectedCanteenId, setSelectedCanteenId] = useState('');
  const [summary, setSummary] = useState<CanteenSummary | null>(null);
  const [lastTransaction, setLastTransaction] = useState<DebitTransaction | null>(null);
  const cardInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      const response = await apiFetch('/auth/me');
      if (response.status === 401) return location.assign('/login');
      const data: MeResponse = await response.json();
      if (!['CANTEEN_CASHIER', 'CANTEEN_OPERATOR'].includes(data.user?.role ?? '') || !data.user?.schoolId) {
        setNotice({ tone: 'error', text: 'هذه الصفحة مخصصة لموظف المقصف فقط. استخدم لوحة الإدارة من حساب المدير.' });
        return;
      }
      setAuthorized(true);
      cardInput.current?.focus();
      void loadCanteens();
    };

    void checkAccess();
    return stopCamera;
  }, []);

  useEffect(() => {
    if (authorized) void loadSummary();
  }, [authorized, selectedCanteenId]);

  function stopCamera() {
    scannerControls.current?.stop();
    scannerControls.current = null;
    if (video.current) video.current.srcObject = null;
    setScanning(false);
  }

  async function loadSummary() {
    const query = selectedCanteenId ? `?canteenId=${encodeURIComponent(selectedCanteenId)}` : '';
    const response = await apiFetch(`/canteen/summary${query}`);
    if (!response.ok) return;
    const data: { summary?: CanteenSummary } = await response.json();
    if (data.summary) setSummary(data.summary);
  }

  async function loadCanteens() {
    const response = await apiFetch('/canteens');
    if (!response.ok) return void loadSummary();
    const data: { canteens?: Canteen[] } = await response.json();
    const nextCanteens = Array.isArray(data.canteens) ? data.canteens : [];
    const requestedCanteenId = new URLSearchParams(location.search).get('canteenId') ?? '';
    const requestedCanteen = nextCanteens.some(canteen => canteen.id === requestedCanteenId) ? requestedCanteenId : '';
    setCanteens(nextCanteens);
    setSelectedCanteenId(current => current || requestedCanteen || nextCanteens[0]?.id || '');
    if (!nextCanteens.length) void loadSummary();
  }

  async function lookupCard(token = cardInput.current?.value ?? '') {
    const cleanToken = token.trim();
    setLookup(null);
    if (cleanToken.length < 20) return;
    const query = new URLSearchParams({ token: cleanToken, ...(selectedCanteenId ? { canteenId: selectedCanteenId } : {}) });
    const response = await apiFetch(`/cards/lookup?${query}`);
    const data: { student?: LookupStudent; error?: string } = await response.json();
    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setNotice({ tone: 'error', text: `تعذر قراءة البطاقة: ${data.error ?? 'UNKNOWN_ERROR'}` });
    setLookup(data.student ?? null);
    setNotice({ tone: 'info', text: `تم التعرف على الطالب: ${data.student?.fullName}. راجع البيانات ثم أدخل مبلغ الخصم.` });
    amountInput.current?.focus();
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice({ tone: 'error', text: 'هذا المتصفح لا يدعم فتح الكاميرا من داخل الموقع. استخدم Safari/Chrome محدث أو قارئ باركود USB.' });
      return;
    }

    if (!video.current) {
      setNotice({ tone: 'error', text: 'تعذر تجهيز نافذة الكاميرا. حدّث الصفحة وحاول مرة أخرى.' });
      return;
    }

    stopCamera();
    setScanning(true);
    setNotice({ tone: 'info', text: 'جاري فتح الكاميرا… اسمح للموقع باستخدام الكاميرا ثم وجّهها إلى QR الموجود في بطاقة الطالب.' });

    const reader = new BrowserMultiFormatReader(scannerHints, {
      delayBetweenScanAttempts: 180,
      delayBetweenScanSuccess: 500,
      tryPlayVideoTimeout: 8000
    });

    try {
      scannerControls.current = await reader.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        video.current,
        result => {
          const value = result?.getText();
          if (!value) return;
          if (cardInput.current) cardInput.current.value = value.trim();
          stopCamera();
          void lookupCard(value);
        }
      );
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        setNotice({ tone: 'error', text: 'تم رفض صلاحية الكاميرا. من إعدادات المتصفح اسمح للموقع باستخدام الكاميرا ثم جرّب مرة أخرى.' });
      } else if (name === 'NotFoundError') {
        setNotice({ tone: 'error', text: 'لم يتم العثور على كاميرا في هذا الجهاز.' });
      } else {
        setNotice({ tone: 'error', text: 'تعذر فتح الكاميرا. تأكد أنك تستخدم رابط HTTPS وأن صلاحية الكاميرا مفعلة.' });
      }
      stopCamera();
    }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await apiFetch('/transactions/debit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data: { transaction?: DebitTransaction; error?: string } = await response.json();

    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setNotice({ tone: 'error', text: `رُفضت العملية: ${data.error ?? 'UNKNOWN_ERROR'}` });

    setLastTransaction(data.transaction ?? null);
    form.reset();
    setLookup(null);
    cardInput.current?.focus();
    setNotice({ tone: 'success', text: `تم الخصم بنجاح من ${data.transaction?.student?.fullName ?? 'الطالب'}: ${data.transaction!.amount} ر.س — الرصيد المتبقي: ${data.transaction!.balanceAfter} ر.س — رقم العملية: ${data.transaction!.reference}` });
    void loadSummary();
  }

  async function refundByReference(reference: string) {
    const response = await apiFetch('/transactions/refund-by-reference', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reference })
    });
    const data: { transaction?: { amount: string; balanceAfter: string; reference: string }; error?: string; replayed?: boolean } = await response.json();

    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setNotice({ tone: 'error', text: `رُفض الاسترجاع: ${data.error ?? 'UNKNOWN_ERROR'}` });

    cardInput.current?.focus();
    setLastTransaction(null);
    setNotice({ tone: 'success', text: `${data.replayed ? 'سبق استرجاع العملية' : 'تم الاسترجاع بنجاح'}: ${data.transaction!.amount} ر.س — الرصيد بعد الاسترجاع: ${data.transaction!.balanceAfter} ر.س` });
    void loadSummary();
  }

  async function refund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const reference = String(new FormData(form).get('reference') ?? '').trim();
    await refundByReference(reference);
    form.reset();
  }

  return (
    <main className="pos">
      <BrandLogo compact />
      <div className="pos-top-actions">
        <a href="/canteen-owner">مقاصفي ومصاريفي</a>
        <LogoutButton />
      </div>
      <h1>شاشة محاسبة المقصف</h1>
      <p>استخدم قارئ الباركود USB مباشرة، أو افتح كاميرا الجوال/التابلت لمسح QR الموجود في بطاقة الطالب.</p>

      {authorized && (
        <>
          <div className="pos-summary">
            <article><small>مستحق المقصف الحالي</small><strong>{summary?.net ?? '0.00'} ر.س</strong></article>
            <article><small>إجمالي الخصومات</small><strong>{summary?.debit ?? '0.00'} ر.س</strong></article>
            <article><small>إجمالي الاسترجاع</small><strong>{summary?.refund ?? '0.00'} ر.س</strong></article>
          </div>

          <form onSubmit={submit}>
            {canteens.length > 0 && (
              <label>
                المقصف
                <select value={selectedCanteenId} onChange={event => { setSelectedCanteenId(event.target.value); setLookup(null); }}>
                  {canteens.map(canteen => <option key={canteen.id} value={canteen.id}>{canteen.name} — {canteen.school.name}</option>)}
                </select>
              </label>
            )}
            {selectedCanteenId && <input type="hidden" name="canteenId" value={selectedCanteenId} />}
            <label>رمز البطاقة<input ref={cardInput} name="cardToken" required minLength={20} placeholder="امسح QR أو الباركود هنا" autoComplete="off" onBlur={() => void lookupCard()} /></label>
            <div className="scan-actions">
              <button type="button" className="secondary" onClick={() => void lookupCard()}>إظهار الطالب</button>
              <button type="button" className="secondary" onClick={() => void startCamera()} disabled={scanning}>مسح بالكاميرا</button>
              {scanning && <button type="button" className="secondary" onClick={stopCamera}>إيقاف الكاميرا</button>}
            </div>
            <video ref={video} className="scanner-preview" muted playsInline autoPlay hidden={!scanning} />
            {lookup && <div className="student-preview"><strong>{lookup.fullName}</strong><span>{lookup.schoolName} — {lookup.studentCode}</span><span>الرصيد: {lookup.balance} ر.س — المتبقي من الحد اليومي: {lookup.todayRemaining} ر.س</span></div>}
            <label>قيمة العملية (ر.س)<input ref={amountInput} name="amount" required type="number" min="0.01" step="0.01" /></label>
            <button>تأكيد الخصم</button>
            {lastTransaction && <button type="button" className="danger-button" onClick={() => void refundByReference(lastTransaction.reference)}>استرجاع آخر عملية: {lastTransaction.amount} ر.س</button>}
          </form>
          <form onSubmit={refund}>
            <h2>استرجاع عملية برقمها</h2>
            <label>رقم العملية<input name="reference" required placeholder="الصق رقم العملية هنا" /></label>
            <button>استرجاع المبلغ</button>
          </form>
        </>
      )}

      {notice && <p role="status" className={`notice ${notice.tone}`}>{notice.text}</p>}
    </main>
  );
}
