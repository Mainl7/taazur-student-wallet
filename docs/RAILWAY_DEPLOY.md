# نشر تآزر على Railway

هذا المشروع يحتاج ثلاث خدمات على Railway:

1. MySQL Database
2. Backend service من مجلد `backend`
3. Frontend service من مجلد `frontend`

## 1. قاعدة البيانات

من Railway:

- أنشئ Project جديد.
- أضف Database واختر MySQL.
- بعد إنشائها ستحتاج قيمة الاتصال `MYSQL_URL` أو تكوين `DATABASE_URL` للباكند.

## 2. نشر الباكند

أضف خدمة من GitHub Repo، واجعل:

- Root Directory: `backend`
- Dockerfile: `backend/Dockerfile`

متغيرات الباكند:

```env
DATABASE_URL=${{MySQL.MYSQL_URL}}
JWT_SECRET=ضع_قيمة_عشوائية_طويلة
WEB_ORIGIN=https://رابط-الواجهة.up.railway.app
```

ملاحظات:

- الباكند يستخدم `PORT` من Railway تلقائيًا.
- عند التشغيل ينفذ `prisma db push` ثم يبدأ API.
- بعد أول نشر، شغّل seed مرة واحدة من Railway Shell:

```bash
npm run prisma:seed
```

## 3. نشر الواجهة

أضف خدمة ثانية من نفس GitHub Repo، واجعل:

- Root Directory: `frontend`
- Dockerfile: `frontend/Dockerfile`

متغيرات الواجهة:

```env
NEXT_PUBLIC_API_URL=https://رابط-الباكند.up.railway.app/api/v1
```

مهم: هذا المتغير يُستخدم وقت بناء الواجهة، لذلك بعد تغييره اعمل Redeploy للواجهة.

## 4. ضبط روابط HTTPS

بعد نشر الخدمتين:

- انسخ رابط الباكند العام وضعه في `NEXT_PUBLIC_API_URL` للواجهة مع `/api/v1`.
- انسخ رابط الواجهة العام وضعه في `WEB_ORIGIN` للباكند.
- أعد نشر الخدمتين.

## 5. اختبار الكاميرا من الجوال

الكاميرا في صفحة المقصف تعمل من المتصفح عندما يكون الموقع عبر HTTPS.

افتح من الجوال:

```text
https://رابط-الواجهة.up.railway.app/canteen
```

ثم سجّل دخول بائع المقصف واضغط `مسح بالكاميرا`.

## 6. قيم سرية مقترحة

استخدم قيمة طويلة عشوائية لـ `JWT_SECRET`.

مثال توليد محلي من PowerShell:

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

## 7. تنبيه إنتاجي

الإعداد الحالي مناسب للتجربة العامة والاختبار الواقعي. قبل تشغيله كبيئة إنتاج رسمية، الأفضل تحويل `prisma db push` إلى migrations منظمة، وتغيير كلمات المرور التجريبية، وتفعيل نسخ احتياطي لقاعدة البيانات.
