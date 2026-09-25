import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import { syncInsights } from "@/lib/meta/sync";

const LEVEL_TABLE = {
  account: { table: "ad_accounts", metaCol: "meta_account_id" },
  campaign: { table: "campaigns", metaCol: "meta_campaign_id" },
  adset: { table: "ad_sets", metaCol: "meta_adset_id" },
  ad: { table: "ads", metaCol: "meta_ad_id" },
} as const;

type Level = keyof typeof LEVEL_TABLE;

export async function POST(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const level = (request.nextUrl.searchParams.get("level") ?? "campaign") as Level;
  const entityId = request.nextUrl.searchParams.get("entityId"); // uuid داخلي، اختياري
  const lookbackDays = Number(request.nextUrl.searchParams.get("lookbackDays") ?? "3");

  if (!LEVEL_TABLE[level]) {
    return NextResponse.json({ error: "invalid level" }, { status: 400 });
  }

  const { table, metaCol } = LEVEL_TABLE[level];
  const supabase = createAdminSupabase();

  let query = supabase.from(table).select(`id, ${metaCol}`);
  if (entityId) query = query.eq("id", entityId);
  const { data: rows, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let total = 0;
  for (const row of (rows ?? []) as any[]) {
    total += await syncInsights(level, row.id, row[metaCol], lookbackDays);
  }

  return NextResponse.json({ insightRowsSynced: total });
}
