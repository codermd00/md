import { NextRequest, NextResponse } from "next/server";
import { assertSyncAuthorized } from "@/lib/meta/authorize-sync";
import { createAdminSupabase } from "@/lib/supabase/server";
import { syncAds } from "@/lib/meta/sync";

export async function POST(request: NextRequest) {
  const unauthorized = assertSyncAuthorized(request);
  if (unauthorized) return unauthorized;

  const adSetId = request.nextUrl.searchParams.get("adSetId"); // ad_sets.id (uuid)، اختياري
  const supabase = createAdminSupabase();

  let query = supabase.from("ad_sets").select("id, meta_adset_id");
  if (adSetId) query = query.eq("id", adSetId);
  const { data: adSets, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let total = 0;
  for (const adSet of adSets ?? []) {
    total += await syncAds(adSet.id, adSet.meta_adset_id);
  }

  return NextResponse.json({ adsSynced: total });
}
