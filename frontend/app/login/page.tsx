'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import BrandLogo from '../components/BrandLogo';
import { apiFetch } from '../lib/api';

type LoginResponse = {
  user?: { email: string; role: string; schoolId?: string | null };
  error?: string;
};

const errorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: 'تعذر تسجيل الدخول. تحقق من البيانات.',
  LOGIN_LOCKED: 'تم قفل محاولات الدخول مؤقتًا بسبب تكرار كلمة مرور خاطئة. حاول بعد 15 دقيقة.',
  VALIDATION_ERROR: 'تحقق من البريد وكلمة المرور.',
  ORIGIN_DENIED: 'تم رفض الطلب لأسباب أمنية.'
};

export default function Login() {
  const [error, setError] = useState('');
  const router = useRouter();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    const response = await apiFetch('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    });
    const data: LoginResponse = await response.json();

    if (!response.ok) return setError(errorMessages[data.error ?? ''] ?? 'تعذر تسجيل الدخول.');

    localStorage.removeItem('taazur_token');
    router.push(['CANTEEN_CASHIER', 'CANTEEN_OPERATOR'].includes(data.user?.role ?? '') && data.user?.schoolId ? '/canteen' : ['CANTEEN_OWNER', 'CANTEEN_OPERATOR'].includes(data.user?.role ?? '') ? '/canteen-owner' : '/');
  }

  return (
    <main className="login">
      <form onSubmit={submit}>
        <BrandLogo compact />
        <p>تسجيل الدخول إلى تآزر</p>
        <label>البريد الإلكتروني<input name="email" type="email" autoComplete="username" required /></label>
        <label>كلمة المرور<input name="password" type="password" autoComplete="current-password" required /></label>
        <button>دخول</button>
        {error && <small role="alert">{error}</small>}
      </form>
    </main>
  );
}
