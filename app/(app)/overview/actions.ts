"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function addQuickNote(formData: FormData) {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return;
  const body = String(formData.get("body") || "").trim();
  if (!body) return;
  await sb.from("notes").insert({ body: body.slice(0, 2000) });
  revalidatePath("/overview");
}

export async function markSeen(campaignId: string, periodStart: string, spend: number) {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return;
  await sb.from("attention_seen").upsert({ campaign_id: campaignId, period_start: periodStart, spend_at_seen: spend, seen_at: new Date().toISOString() });
  revalidatePath("/overview");
}
