"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function saveGoal(input: {
  campaignId: string; periodStart: string; budget: string; target: string;
}): Promise<{ ok: boolean; message: string }> {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false, message: "غير مصرّح" };
  const budget = input.budget.trim() === "" ? null : Number(input.budget);
  const target = input.target.trim() === "" ? null : Number(input.target);
  if ((budget !== null && !(budget >= 0)) || (target !== null && !(target >= 0)))
    return { ok: false, message: "أرقام غير صحيحة" };
  const { error } = await sb.from("campaign_goals").upsert(
    {
      campaign_id: input.campaignId, period_start: input.periodStart, budget, target,
      source: "manual", updated_at: new Date().toISOString(),
    },
    { onConflict: "campaign_id,period_start" }
  );
  if (error) return { ok: false, message: error.message };
  revalidatePath("/performance");
  return { ok: true, message: "تم الحفظ" };
}
