import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTelegram } from "./telegram";
import { syncClient } from "./sync";
import { todayStr } from "./dates";

const TZ = process.env.APP_TIMEZONE || "Asia/Baghdad";
const LABEL: Record<string, string> = { messages: "Messages", engagement: "Engagement", reach: "Reach", visit: "Visit" };

function nowHM(): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

/** Runs the daily cost alerts that are due now (Baghdad time). Safe to call every minute. */
export async function runDueAlerts(db: SupabaseClient): Promise<string> {
  const { data: rows } = await db.from("settings").select("key,value").in("key", ["alert_times", "alert_last"]);
  const get = (k: string) => (rows || []).find((r: any) => r.key === k)?.value;
  const times = String(get("alert_times") || "12:00,18:00").split(",").map((t) => t.trim()).filter((t) => /^\d{1,2}:\d{2}$/.test(t))
    .map((t) => t.padStart(5, "0"));
  const today = todayStr();
  const last: Record<string, string> = (get("alert_last") && typeof get("alert_last") === "object") ? get("alert_last") : {};
  const hm = nowHM();
  const due = times.filter((t) => t <= hm && last[t] !== today);
  if (!due.length) return "";
  // mark first so overlapping calls never double-send; a late slot only fires once
  const next = { ...last }; for (const t of due) next[t] = today;
  await db.from("settings").upsert({ key: "alert_last", value: next }, { onConflict: "key" });
  // only the latest due slot actually sends (avoid a burst if the app was down)
  const slot = due[due.length - 1];

  const { data: clients } = await db.from("clients").select("id,name,alert_limits");
  let sent = 0;
  for (const c of (clients || []) as any[]) {
    const lim = c.alert_limits || {};
    if (!Object.values(lim).some((v) => Number(v) > 0)) continue;
    await syncClient(c.id).catch(() => null); // fresh numbers for today
    const [{ data: camps }, { data: daily }] = await Promise.all([
      db.from("campaigns").select("id,name,type").eq("client_id", c.id),
      db.from("insights_daily").select("entity_id,spend,results").eq("client_id", c.id).eq("level", "campaign").eq("day", today),
    ]);
    const lines: string[] = [];
    for (const k of (camps || []) as any[]) {
      const limit = Number(lim[k.type]);
      if (!(limit > 0)) continue;
      const d = (daily || []).find((x: any) => x.entity_id === k.id);
      const spend = Number(d?.spend) || 0, res = Number(d?.results) || 0;
      if (spend <= 0) continue;
      const cost = res > 0 ? (k.type === "reach" ? (spend / res) * 1000 : spend / res) : null;
      if (cost !== null ? cost > limit : spend > limit)
        lines.push(`${LABEL[k.type] || k.type}: ${cost !== null ? "$" + cost.toFixed(3) + (k.type === "reach" ? " /1K" : "") : "no results ($" + spend.toFixed(2) + " spent)"}  (limit $${limit})`);
    }
    if (lines.length && (await sendTelegram(`⚠️ ${c.name}\n${lines.join("\n")}`))) sent++;
  }
  return `alerts ${slot}: ${sent}`;
}
