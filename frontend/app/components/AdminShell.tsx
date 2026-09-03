'use client';

import { ReactNode, useEffect, useState } from 'react';
import BrandLogo from './BrandLogo';
import LogoutButton from './LogoutButton';
import { apiFetch } from '../lib/api';

export default function AdminShell({ children }: { children: ReactNode }) {
  const [allowed, setAllowed] = useState(false);
  const [schoolViewer, setSchoolViewer] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      const response = await apiFetch('/auth/me');
      if (response.status === 401) return location.assign('/login');
      const data: { user?: { role: string; schoolId?: string | null } } = await response.json();
      if (['CANTEEN_CASHIER', 'CANTEEN_OPERATOR'].includes(data.user?.role ?? '') && data.user?.schoolId) return location.assign('/canteen');
      if (['CANTEEN_OWNER', 'CANTEEN_OPERATOR'].includes(data.user?.role ?? '')) return location.assign('/canteen-owner');
      const isSchoolViewer = ['AUDITOR', 'SCHOOL_ADMIN'].includes(data.user?.role ?? '') && Boolean(data.user?.schoolId);
      if (isSchoolViewer && !['/school-manager', '/account'].includes(location.pathname)) return location.assign('/school-manager');
      setSchoolViewer(isSchoolViewer);
      setAllowed(true);
    };

    void checkAccess();
  }, []);

  if (!allowed) return <main className="login"><p role="status">جاري التحقق من صلاحية الدخول...</p></main>;

  return (
    <main>
      <aside>
        <BrandLogo />
        {schoolViewer ? (
          <nav>
            <a href="/school-manager">واجهة مدير المدرسة</a>
            <a href="/account">الحساب والأمان</a>
            <LogoutButton />
          </nav>
        ) : (
          <nav>
            <a href="/">لوحة التحكم</a>
            <a href="/schools">المدارس</a>
            <a href="/students">الطلاب</a>
            <a href="/cards">البطاقات</a>
            <a href="/wallets">مبالغ الفسحة</a>
            <a href="/canteen-users">ملاك المقاصف</a>
            <a href="/school-managers">مدراء المدارس</a>
            <a href="/canteen-settlements">تسوية المقاصف</a>
            <a href="/reports">التقارير</a>
            <a href="/alerts">التنبيهات</a>
            <a href="/exports">التصدير</a>
            <a href="/transactions">العمليات</a>
            <a href="/audit-logs">التدقيق</a>
            <a href="/account">الحساب والأمان</a>
            <a href="/system">صحة النظام</a>
            <LogoutButton />
          </nav>
        )}
      </aside>
      <section><div className="management">{children}</div></section>
    </main>
  );
}
