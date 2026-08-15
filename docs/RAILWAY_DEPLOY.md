# نشر تآزر على Railway

المشروع يحتاج ثلاث خدمات على Railway:

1. MySQL Database
2. Backend service من مجلد `backend`
3. Frontend service من مجلد `frontend`

## متغيرات الباكند

```env
DATABASE_URL=${{MySQL.MYSQL_URL}}
JWT_SECRET=قيمة_عشوائية_طويلة
WEB_ORIGIN=https://رابط-الواجهة.up.railway.app
COOKIE_SECURE=true
OFFICIAL_ADMIN_EMAIL=admin@taazur.org
OFFICIAL_ADMIN_PASSWORD=كلمة_مرور_قوية_لا_توضع_في_Git
```

الباكند يستخدم Prisma migrations عند التشغيل:

```bash
npx prisma migrate deploy
npm run prisma:seed
```

لا تستخدم `prisma db push` في الإنتاج.

## متغيرات الواجهة

```env
NEXT_PUBLIC_API_URL=https://رابط-الباكند.up.railway.app/api/v1
```

بعد تغيير هذا المتغير أعد نشر الواجهة لأنه يُستخدم وقت البناء.

## ملاحظات أمان

- حسابات التجربة `admin@taazur.local` و `operator@taazur.local` لا تُستخدم في الإنتاج ويتم حذفها أو تعطيلها تلقائيًا في seed.
- الدخول يعتمد على Cookie آمن `HttpOnly + Secure + SameSite=None`.
- الواجهة ترسل الطلبات إلى الباكند مع `credentials: include`.
- يوجد قفل مؤقت بعد تكرار محاولات دخول فاشلة.
- سجل التدقيق يحفظ المدرسة و IP و User-Agent للعمليات المهمة.
- فعّل النسخ الاحتياطي لقاعدة البيانات قبل الاستخدام الحقيقي.
