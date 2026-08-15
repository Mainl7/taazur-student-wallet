import { ReactNode } from 'react';
import BrandLogo from './BrandLogo';
import LogoutButton from './LogoutButton';

export default function AdminShell({ children }: { children: ReactNode }) {
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
          <a href="/canteen-users">حسابات المقصف</a>
          <a href="/transactions">العمليات</a>
          <a href="/audit-logs">التدقيق</a>
          <LogoutButton />
        </nav>
      </aside>
      <section><div className="management">{children}</div></section>
    </main>
  );
}
