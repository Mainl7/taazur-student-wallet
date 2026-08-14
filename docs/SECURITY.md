# Security baseline

- لا تضع بيانات حساسة في QR أو في Git؛ البطاقة تحمل token عشوائيًا فقط.
- كلمات المرور Argon2، وJWT قصير العمر. أضف refresh-token rotation وMFA للمشرفين قبل الإطلاق.
- Helmet وCORS موجودان؛ قيّد origin في الإنتاج وأضف rate-limit/backed Redis.
- لا تكشف رسائل database أو stack traces للعميل في بيئة الإنتاج.
- قصر تصدير التقارير وسجل التدقيق على الأدوار المخوّلة، ولا تسمح بحذف السجل.
