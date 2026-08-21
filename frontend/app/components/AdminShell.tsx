'use client';

import { ReactNode, useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';
import LogoutButton from './LogoutButton';
import { apiFetch } from '../lib/api';

export default function AdminShell({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      const response = await apiFetch('/auth/me');
      if (response.status === 401) return location.assign('/login');
      const data: { user?: { role: string; schoolId?: string | null } } = await response.json();
      if (data.user?.role === 'CANTEEN_OPERATOR') return location.assign(data.user.schoolId ? '/canteen' : '/canteen-owner');
      setAllowed(true);
    };

    void checkAccess();
  }, []);

  if (!allowed) return <main className="login"><p role="status">جاري التحقق من صلاحية الدخول...</p></main>;

  return (
    <main>
      <aside>
        <BrandLogo />
        <nav>
          <a href="/">لوحة التحكم</a>
          <a href="/schools">المدارس</a>
          <a href="/students">الطلاب</a>
          <a href="/cards">البطاقات</a>
          <a href="/wallets">المحافظ</a>
          <a href="/canteen-users">ملاك المقاصف</a>
          <a href="/canteen-settlements">تسوية المقاصف</a>
          <a href="/reports">التقارير</a>
          <a href="/alerts">التنبيهات</a>
          <a href="/exports">التصدير</a>
          <a href="/transactions">العمليات</a>
          <a href="/audit-logs">التدقيق</a>
          <LogoutButton />
        </nav>
      </aside>
      <section><div className="management">{children}</div></section>
    </main>
  );
}
