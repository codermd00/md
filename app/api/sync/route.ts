import { NextRequest, NextResponse } from "next/server";
import { syncAll, syncClient } from "@/lib/sync";
import { createAdminSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// تستدعيه حاوية cron كل دقيقة بـ ?due=1، والفاصل الفعلي من الإعدادات (sync_interval بالدقائق)
export async function POST(req: NextRequest) {
  const secret = process.env.SYNC_SECRET;
  if (!secret || req.headers.get("x-sync-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (req.nextUrl.searchParams.get("due")) {
    const db = createAdminSupabase();
    const { data } = await db.from("settings").select("key,value").in("key", ["sync_interval", "last_auto_sync"]);
    const get = (k: string) => (data || []).find((r: any) => r.key === k)?.value;
    const mins = Math.max(Number(get("sync_interval")) || 15, 5);
    const last = Date.parse(String(get("last_auto_sync") || ""));
    if (Number.isFinite(last) && Date.now() - last < mins * 60_000 - 30_000) return NextResponse.json({ skipped: true });
    await db.from("settings").upsert({ key: "last_auto_sync", value: new Date().toISOString() }, { onConflict: "key" });
  }
  const clientId = req.nextUrl.searchParams.get("client");
  const result = clientId ? [{ id: clientId, ...(await syncClient(clientId)) }] : await syncAll();
  return NextResponse.json({ results: result });
}
