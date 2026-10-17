# Ads Dashboard — المرحلة 1 (الأساس)

## الخطوات
1. **Supabase → SQL Editor:** شغّل `sql/000_reset.sql` (يحذف القديم) ثم `sql/001_schema.sql`.
2. **Authentication → Users:** أنشئ مستخدمك (بريد + كلمة مرور) وعطّل التسجيل العام.
3. **GitHub:** ارفع المشروع (مستودع جديد أو استبدل القديم).
4. **Portainer → Stack (Repository):** ضع المتغيرات من `.env.example` (META_ACCESS_TOKEN، مفاتيح Supabase، SYNC_SECRET ...) ثم Deploy.
5. افتح الموقع ← Settings ← **اختبر الاتصال** لكل حساب إعلاني وأرسل لي النتيجة.

## ملاحظات
- لا تضع أي توكن في الكود. Telegram اختياري الآن (متغيرات TELEGRAM_*).
- المراحل التالية: Clients ← Performance ← Overview ← CRM ← Content Manager ← Tasks.

## المرحلة 5 — CRM (Webhook)

1. شغّل `sql/006_crm.sql` في Supabase SQL Editor.
2. Supabase ← **Edge Functions** ← **Create a new function** باسم `meta-webhook`، والصق محتوى `supabase/functions/meta-webhook/index.ts`، ثم **Deploy**.
   - في إعدادات الدالة **عطّل "Verify JWT"** (Meta لا ترسل توكن Supabase).
3. Supabase ← Edge Functions ← **Secrets**: أضف `META_VERIFY_TOKEN` (أي نص تختاره). اختيارياً `META_APP_SECRET` (من تطبيق Meta) للتحقق من توقيع الرسائل.
4. تطبيق Meta ← Webhooks ← Page (وInstagram إن لزم):
   - Callback URL: `https://<project-ref>.supabase.co/functions/v1/meta-webhook`
   - Verify token: نفس قيمة `META_VERIFY_TOKEN`
   - اشترك في الحقلين `messages` و`messaging_referrals`، واربط التطبيق بالصفحة.
5. تأكد أن `page_id` للعميل مخزّن (يُكتشف في Sync now) لأن الدالة تربط الرسالة بالعميل عبره.
