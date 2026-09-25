import { NextRequest, NextResponse } from "next/server";

/**
 * يتحقق من هيدر x-sync-secret قبل تنفيذ أي عملية مزامنة.
 * هذا يحمي /api/sync/* من الاستدعاء الخارجي (لا علاقة له بجلسة المستخدم/الفرونت إند).
 * يُستخدم من: زر Manual Sync (يرسله من السيرفر لا من المتصفح) وسكربت الـ cron على الـ VPS.
 */
export function assertSyncAuthorized(request: NextRequest): NextResponse | null {
  const secret = process.env.SYNC_SECRET;
  const simpleHeader = request.headers.get("x-sync-secret");
  const authHeader = request.headers.get("authorization"); // "Bearer <secret>"
  const bearerValue = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  const provided = simpleHeader || bearerValue;

  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
