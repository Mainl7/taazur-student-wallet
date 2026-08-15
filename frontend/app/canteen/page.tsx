'use client';

import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { FormEvent, useEffect, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo';
import { apiFetch } from '../lib/api';

type MeResponse = { user?: { role: string }; error?: string };

const scannerHints = new Map<DecodeHintType, unknown>([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128, BarcodeFormat.CODE_39]
  ],
  [DecodeHintType.TRY_HARDER, true]
]);

export default function Canteen() {
  const [notice, setNotice] = useState('');
  const [authorized, setAuthorized] = useState(false);
  const [scanning, setScanning] = useState(false);
  const cardInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scannerControls = useRef<IScannerControls | null>(null);

  useEffect(() => {
    const checkAccess = async () => {
      const response = await apiFetch('/auth/me');
      if (response.status === 401) return location.assign('/login');
      const data: MeResponse = await response.json();
      if (data.user?.role !== 'CANTEEN_OPERATOR') {
        setNotice('هذه الصفحة مخصصة لموظف المقصف فقط. استخدم لوحة الإدارة من حساب المدير.');
        return;
      }
      setAuthorized(true);
      cardInput.current?.focus();
    };

    void checkAccess();
    return stopCamera;
  }, []);

  function stopCamera() {
    scannerControls.current?.stop();
    scannerControls.current = null;
    if (video.current) video.current.srcObject = null;
    setScanning(false);
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setNotice('هذا المتصفح لا يدعم فتح الكاميرا من داخل الموقع. استخدم Safari/Chrome محدث أو قارئ باركود USB.');
      return;
    }

    if (!video.current) {
      setNotice('تعذر تجهيز نافذة الكاميرا. حدّث الصفحة وحاول مرة أخرى.');
      return;
    }

    stopCamera();
    setScanning(true);
    setNotice('جاري فتح الكاميرا… اسمح للموقع باستخدام الكاميرا ثم وجّهها إلى QR الموجود في بطاقة الطالب.');

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
          setNotice('تمت قراءة رمز البطاقة. أدخل المبلغ ثم اضغط تأكيد الخصم.');
          stopCamera();
          cardInput.current?.focus();
        }
      );
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError') {
        setNotice('تم رفض صلاحية الكاميرا. من إعدادات المتصفح اسمح للموقع باستخدام الكاميرا ثم جرّب مرة أخرى.');
      } else if (name === 'NotFoundError') {
        setNotice('لم يتم العثور على كاميرا في هذا الجهاز.');
      } else {
        setNotice('تعذر فتح الكاميرا. تأكد أنك تستخدم رابط HTTPS وأن صلاحية الكاميرا مفعلة.');
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
    const data: { transaction?: { amount: string; balanceAfter: string; reference: string }; error?: string } = await response.json();

    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setNotice(`رُفضت العملية: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    cardInput.current?.focus();
    setNotice(`تم الخصم بنجاح: ${data.transaction!.amount} ر.س — الرصيد المتبقي: ${data.transaction!.balanceAfter} ر.س — رقم العملية: ${data.transaction!.reference}`);
  }

  async function refund(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const response = await apiFetch('/transactions/refund-by-reference', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    const data: { transaction?: { amount: string; balanceAfter: string; reference: string }; error?: string; replayed?: boolean } = await response.json();

    if (response.status === 401) return location.assign('/login');
    if (!response.ok) return setNotice(`رُفض الاسترجاع: ${data.error ?? 'UNKNOWN_ERROR'}`);

    form.reset();
    cardInput.current?.focus();
    setNotice(`${data.replayed ? 'سبق استرجاع العملية' : 'تم الاسترجاع بنجاح'}: ${data.transaction!.amount} ر.س — الرصيد بعد الاسترجاع: ${data.transaction!.balanceAfter} ر.س`);
  }

  return (
    <main className="pos">
      <BrandLogo compact />
      <h1>مقصف المدرسة</h1>
      <p>استخدم قارئ الباركود USB مباشرة، أو افتح كاميرا الجوال/التابلت لمسح QR الموجود في بطاقة الطالب.</p>

      {authorized && (
        <>
          <form onSubmit={submit}>
            <label>رمز البطاقة<input ref={cardInput} name="cardToken" required minLength={20} placeholder="امسح QR أو الباركود هنا" autoComplete="off" /></label>
            <div className="scan-actions">
              <button type="button" className="secondary" onClick={() => void startCamera()} disabled={scanning}>مسح بالكاميرا</button>
              {scanning && <button type="button" className="secondary" onClick={stopCamera}>إيقاف الكاميرا</button>}
            </div>
            <video ref={video} className="scanner-preview" muted playsInline autoPlay hidden={!scanning} />
            <label>قيمة العملية (ر.س)<input name="amount" required type="number" min="0.01" step="0.01" /></label>
            <button>تأكيد الخصم</button>
          </form>
          <form onSubmit={refund}>
            <h2>استرجاع عملية</h2>
            <label>رقم العملية<input name="reference" required placeholder="الصق رقم العملية هنا" /></label>
            <button>استرجاع المبلغ</button>
          </form>
        </>
      )}

      {notice && <p role="status">{notice}</p>}
    </main>
  );
}
