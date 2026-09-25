// سكربت مستقل يُستدعى من crontab على الـ VPS لتشغيل المزامنة الكاملة.
// لا يحتاج Vercel Cron — فقط استدعاء HTTP لموقعك نفسه.
//
// مثال إضافته في crontab (كل 30 دقيقة):
//   [30 دقيقة] cd /path/to/meta-ads-dashboard && npm run sync >> /var/log/meta-sync.log 2>&1
import "dotenv/config";

async function main() {
  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const secret = process.env.SYNC_SECRET;

  if (!secret) {
    console.error("SYNC_SECRET غير موجود في متغيرات البيئة");
    process.exit(1);
  }

  const res = await fetch(`${appUrl}/api/sync/full`, {
    method: "POST",
    headers: { "x-sync-secret": secret },
  });

  const body = await res.json();
  console.log(`[${new Date().toISOString()}]`, res.status, body);

  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
