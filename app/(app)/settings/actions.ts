"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { testClientConnectivity, type ConnectivityResult } from "@/lib/connectivity";

async function requireUser() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error("Unauthorized");
  return sb;
}

export async function runConnectivity(adAccount: string): Promise<ConnectivityResult> {
  await requireUser();
  if (!adAccount.trim()) throw new Error("Enter the ad account ID");
  return testClientConnectivity(adAccount);
}

const NUMERIC = ["late_threshold", "goal_risk_days", "day_hours", "default_budget", "default_days", "sync_interval"] as const;
const BOOLS = ["notify_new_post", "notify_run_done", "notify_error"] as const;

export async function saveSettings(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const rows: { key: string; value: unknown }[] = [];
  for (const k of NUMERIC) {
    const n = Number(formData.get(k));
    if (!Number.isFinite(n) || n <= 0) return { ok: false, message: `Invalid value: ${k}` };
    if (k === "sync_interval" && n < 5) return { ok: false, message: "Minimum sync interval is 5 minutes" };
    rows.push({ key: k, value: n });
  }
  for (const k of BOOLS) rows.push({ key: k, value: formData.get(k) === "on" });
  const { error } = await sb.from("settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, message: error.message };
  // Ready posts with no ad set chosen yet follow the new defaults
  await sb.from("posts").update({
    budget: rows.find((r) => r.key === "default_budget")?.value, days: rows.find((r) => r.key === "default_days")?.value,
  }).eq("status", "ready").is("meta_adset_id", null);
  revalidatePath("/settings");
  revalidatePath("/content");
  return { ok: true, message: "Saved" };
}
