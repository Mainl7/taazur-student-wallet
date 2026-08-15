'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import BrandLogo from '../components/BrandLogo';
import { apiFetch } from '../lib/api';

type DetectorResult = { rawValue: string };
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => { detect(source: HTMLVideoElement): Promise<DetectorResult[]> };

export default function Canteen() {
  const [notice, setNotice] = useState('');
  const [scanning, setScanning] = useState(false);
  const cardInput = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const loop = useRef<number | null>(null);

  useEffect(() => { cardInput.current?.focus(); return stopCamera; }, []);

  function stopCamera() {
    if (loop.current) cancelAnimationFrame(loop.current);
    loop.current = null;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    setScanning(false);
  }

  async function startCamera() {
    const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Detector) return setNotice('المتصفح لا يدعم قراءة الباركود بالكاميرا. جرّب Chrome على Android أو استخدم قارئ USB.');

    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!video.current) return;
      video.current.srcObject = stream.current;
      await video.current.play();
      setScanning(true);
      const detector = new Detector({ formats: ['code_128', 'code_39', 'ean_13', 'qr_code'] });
      const scan = async () => {
        if (!video.current || !stream.current) return;
        const codes = await detector.detect(video.current).catch(() => []);
        const value = codes[0]?.rawValue;
        if (value) {
          if (cardInput.current) cardInput.current.value = value;
          setNotice('تمت قراءة الباركود. أدخل المبلغ ثم اضغط تأكيد الخصم.');
          stopCamera();
          cardInput.current?.focus();
          return;
        }
        loop.current = requestAnimationFrame(scan);
      };
      loop.current = requestAnimationFrame(scan);
    } catch {
      setNotice('تعذر فتح الكاميرا. غالبًا تحتاج السماح للمتصفح باستخدام الكاميرا وفتح الموقع عبر HTTPS.');
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
      <p>استخدم قارئ الباركود USB مباشرة، أو افتح كاميرا الجوال/التابلت لمسح البطاقة.</p>
      <form onSubmit={submit}>
        <label>رمز البطاقة<input ref={cardInput} name="cardToken" required minLength={20} placeholder="امسح الباركود هنا" autoComplete="off" /></label>
        <div className="scan-actions">
          <button type="button" className="secondary" onClick={() => void startCamera()}>مسح بالكاميرا</button>
          {scanning && <button type="button" className="secondary" onClick={stopCamera}>إيقاف الكاميرا</button>}
        </div>
        {scanning && <video ref={video} className="scanner-preview" muted playsInline />}
        <label>قيمة العملية (ر.س)<input name="amount" required type="number" min="0.01" step="0.01" /></label>
        <button>تأكيد الخصم</button>
      </form>
      <form onSubmit={refund}>
        <h2>استرجاع عملية</h2>
        <label>رقم العملية<input name="reference" required placeholder="الصق رقم العملية هنا" /></label>
        <button>استرجاع المبلغ</button>
      </form>
      {notice && <p role="status">{notice}</p>}
    </main>
  );
}
