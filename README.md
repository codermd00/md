# Meta Ads Dashboard

نظام شخصي لإدارة وتحليل الحسابات الإعلانية عبر Meta API — Next.js + Supabase.

## 1) التثبيت

```bash
npm install
cp .env.example .env.local
```

عبّئ القيم في `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` و `NEXT_PUBLIC_SUPABASE_ANON_KEY` و `SUPABASE_SERVICE_ROLE_KEY` — من Supabase Project Settings → API.
- `META_ACCESS_TOKEN` — التوكن الجاهز لديك.
- `META_API_VERSION` — مضبوط مسبقاً على `v24.0`.
- `SYNC_SECRET` — قيمة عشوائية طويلة من عندك (مثال: `openssl rand -hex 32`)، تُستخدم لحماية مسارات `/api/sync/*`.
- `APP_URL` — رابط الموقع بعد رفعه على الـ VPS (مثلاً `https://ads.yourdomain.com`).

## 2) تفعيل Supabase Auth

من لوحة Supabase → Authentication → أنشئ مستخدماً واحداً (بريدك) بكلمة مرور. هذا هو المستخدم الوحيد الذي سيدخل النظام.

## 3) التشغيل محلياً

```bash
npm run dev
```

افتح `http://localhost:3000` → سيحوّلك مباشرة لصفحة `/login`.

## 4) النشر بدون أي سيرفر — Vercel (الطريقة الموصى بها)

هذه الطريقة لا تحتاج SSH ولا Docker ولا حتى تيرمنال — فقط متصفح.

### أ) ارفع المشروع على GitHub (بدون Git، بالسحب والإفلات)

1. أنشئ حساب مجاني على [github.com](https://github.com) إذا ما عندك واحد.
2. اضغط **New repository**، أعطه اسماً (مثلاً `meta-ads-dashboard`)، اجعله **Private**، ثم Create repository.
3. في صفحة المستودع الفارغ، اضغط **uploading an existing file**.
4. اسحب وأفلت **كل محتويات مجلد المشروع** (وليس المجلد نفسه — ادخل داخله وحدد كل الملفات والمجلدات الفرعية) إلى الصفحة.
5. اضغط **Commit changes**.

### ب) اربطه بـ Vercel

1. افتح [vercel.com](https://vercel.com) وسجّل حساب مجاني (الأسهل: **Continue with GitHub**).
2. اضغط **Add New… → Project**.
3. اختر المستودع الذي رفعته (`meta-ads-dashboard`).
4. قبل الضغط على Deploy، افتح **Environment Variables** وأضف كل القيم من `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `META_ACCESS_TOKEN`
   - `META_API_VERSION` = `v24.0`
   - `SYNC_SECRET` = أي نص عشوائي طويل من عندك
5. اضغط **Deploy**. بعد دقيقة أو دقيقتين يعطيك رابطاً مثل `https://meta-ads-dashboard.vercel.app` — هذا هو نظامك، يعمل 24 ساعة بدون أي جهاز تشغّله أنت.

أي تعديل لاحق على الكود: ترفعه على نفس مستودع GitHub (نفس خطوة "uploading an existing file")، وVercel يعيد النشر تلقائياً خلال ثوانٍ.

## 5) جدولة المزامنة التلقائية (بدون سيرفر أيضاً)

خطة Vercel المجانية تسمح بجدولة تلقائية مرة واحدة باليوم فقط، وأنت تحتاج كل 15-30 دقيقة. الحل: خدمة مجانية خارجية تستدعي رابط المزامنة بدلاً منك.

1. أنشئ حساباً مجانياً في [cron-job.org](https://cron-job.org).
2. أنشئ **Cronjob** جديد:
   - **URL**: `https://your-project.vercel.app/api/sync/full` (استبدل بالرابط الحقيقي من Vercel)
   - **Schedule**: كل 30 دقيقة (أو حسب رغبتك)
   - في **Advanced → Headers** أضف: `x-sync-secret` = نفس القيمة اللي وضعتها في `SYNC_SECRET` بـ Vercel
3. احفظ. من الآن، سيتم استدعاء المزامنة تلقائياً حسب الجدول، بدون أي جهاز أو سيرفر من طرفك.

لتجربة مزامنة فورية يدوياً، أسهل طريقة هي من داخل لوحة cron-job.org نفسها بزر **Run now**، أو باستخدام أي أداة تدعم إرسال Headers مخصصة (Postman، أو إضافة متصفح مثل ModHeader) لاستدعاء نفس الرابط مع هيدر `x-sync-secret`. زر Manual Sync داخل الواجهة نفسها يُضاف في مرحلة لاحقة من التطوير.

## ملحق: التشغيل الذاتي (Docker / VPS / Umbrel) — اختياري

إذا رغبت لاحقاً بتشغيل النظام على جهازك الخاص بدل Vercel، الملفات التالية جاهزة لذلك:
- `Dockerfile` + `docker-compose.yml` + مجلد `cron/` — للتشغيل عبر Docker (مناسب لـ Umbrel أو أي VPS).
- `scripts/cron-sync.ts` — سكربت بديل يُستدعى من crontab النظام مباشرة بدون Docker.

هذا المسار يتطلب SSH ومعرفة أساسية بـ Docker، ولذلك لا يُنصح به إلا إذا كان لديك سبب معيّن (خصوصية كاملة للبيانات، تجربة سابقة مع Umbrel، إلخ).

## 6) هيكل المشروع

```
app/
  layout.tsx              ← القالب العام + الشريط الجانبي
  login/                  ← صفحة الدخول (Supabase Auth)
  (dashboard)/overview/   ← الصفحة الرئيسية (KPI cards)
  api/sync/                ← مسارات المزامنة (محمية بـ SYNC_SECRET)
lib/
  supabase/               ← عملاء Supabase (browser / server / admin)
  meta/
    client.ts             ← طبقة نداءات Meta Graph API (pagination + retry)
    sync.ts               ← منطق تحويل بيانات Meta إلى صفوف Supabase (upsert)
    authorize-sync.ts      ← حماية مسارات المزامنة
scripts/cron-sync.ts       ← سكربت التشغيل من crontab
middleware.ts               ← حماية كل الصفحات عدا /login و /api/sync
```

## 7) الحالة الحالية (نهاية المرحلة 1)

- ✅ Supabase schema + RLS (تم تنفيذه مسبقاً).
- ✅ Supabase Auth + حماية الصفحات عبر middleware.
- ✅ طبقة Meta API كاملة (accounts/campaigns/adsets/ads/insights) مع pagination وrate-limit retry.
- ✅ مسارات المزامنة الكاملة + تسجيل sync_logs.
- ✅ سكربت cron جاهز لـ VPS.
- ✅ Overview أولية تقرأ KPIs حقيقية من Supabase.
- ⏳ باقي الصفحات (Clients, Accounts, Campaigns, Budget Planner, Alerts, Notes, Analysis Engine...) — المراحل 2 إلى 5 من خطة التنفيذ.

## الخطوة التالية

المرحلة 2: صفحات CRUD لـ Clients و Ad Accounts (إضافة/تعديل/ربط)، ثم اختبار أول Manual Sync فعلي.
