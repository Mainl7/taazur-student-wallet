# تآزر — نظام المصروف المدرسي

منصة لإدارة محافظ طلاب الجمعية وعمليات المقصف، مبنية بحيث تكون MySQL هي مصدر الحقيقة الوحيد للأرصدة والمعاملات.

## التشغيل المحلي

1. انسخ `.env.example` إلى `.env` وعدّل الأسرار.
2. شغّل `docker compose up --build`.
3. طبّق القاعدة بعد إقلاع MySQL: `docker compose exec backend npx prisma migrate dev --name init`.
4. الواجهة: `http://localhost:3000`، والتحقق الصحي: `http://localhost:4000/api/v1/health`.

لا يصلح إعداد Docker الافتراضي للإنتاج؛ غيّر جميع الأسرار وكلمات المرور، فعّل TLS، وأضف migration job قبل النشر.

## طبقات التطبيق

- `frontend`: Next.js RTL (لوحة الإدارة والمقصف).
- `backend`: Express/TypeScript، مصادقة، تفويض، validation، وخدمات مالية.
- `backend/prisma`: مخطط MySQL والعلاقات والقيود.
- `docs`: قرارات التصميم والعقود الأولية للـ API.

## ضمانات المعاملة المالية

نقطة الخصم تتطلب `Idempotency-Key` وتستخدم MySQL transaction مع `SELECT … FOR UPDATE`. لا يُخصم الرصيد مرتين عند إعادة الطلب؛ ويُسجل كل تغيير في دفتر الأستاذ `WalletTransaction`.
