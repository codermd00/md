import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { addDays, todayStr } from "@/lib/dates";
import { campaignStart, computeProgress, type Progress } from "@/lib/progress";
import { fetchAll } from "@/lib/fetchall";
import { TYPE_LABEL } from "@/lib/results";
import DataHealth from "@/components/DataHealth";
import OverviewGrid, { type OvCard } from "@/components/OverviewGrid";

export const dynamic = "force-dynamic";

const ACCOUNT_HINT: Record<string, string> = {
  unsettled: "Unpaid balance",
  grace_period: "Payment grace period",
  pending_settlement: "Payment pending",
  pending_review: "Under review",
  pending_closure: "Closing",
  disabled: "Account disabled",
  closed: "Account closed",
  temporarily_unavailable: "Temporarily unavailable",
};
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "Now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const RUNNING_SPEND = 0.5; // running campaign = ACTIVE and spend above this

type Row = { camp: any; p: Progress; spend: number; ratio: number; late: boolean; seen: boolean };
type Group = { client: any; notes: { text: string; level: "bad" | "warn" }[]; rows: Row[]; noTarget: any[] };

export default async function OverviewPage() {
  const sb = createServerSupabase();
  const today = todayStr();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const recentFrom = addDays(today, -2);
  const periodsFrom = addDays(today, -70); // client periods are monthly: older data is not needed here
  const nowIso = new Date().toISOString();
  // started together with the first batch: the whole page costs one round trip
  const secondP = Promise.all([
    fetchAll<any>((a, b) => sb.from("insights_range").select("entity_id,date_from,spend,results").eq("level", "campaign").gte("date_from", periodsFrom).order("synced_at", { ascending: false }).order("id", { ascending: false }).range(a, b) as any),
    fetchAll<any>((a, b) => sb.from("campaign_goals").select("campaign_id,period_start,target,budget").gte("period_start", periodsFrom).range(a, b) as any),
    // only live ad sets matter: ON and not past their end date
    fetchAll<any>((a, b) => sb.from("ad_sets").select("campaign_id,effective_status,end_time").eq("effective_status", "ACTIVE").or(`end_time.is.null,end_time.gt.${nowIso}`).range(a, b) as any),
    fetchAll<any>((a, b) => sb.from("insights_daily").select("entity_id,spend").eq("level", "campaign").gte("day", recentFrom).gt("spend", 0).range(a, b) as any),
  ]);

  const [{ data: clients }, { data: setRows }, { data: camps }, { data: logs }, { data: seenRows }] = await Promise.all([
    sb.from("clients").select("id,name,period_start,period_end,account_status,synced_at").order("name"),
    sb.from("settings").select("key,value").eq("key", "late_threshold"),
    sb.from("campaigns").select("id,client_id,name,type,effective_status,start_time,stop_time"),
    sb.from("sync_log").select("client_id,ok,detail,created_at").gte("created_at", dayAgo).order("created_at", { ascending: false }).limit(200),
    sb.from("attention_seen").select("campaign_id,period_start,spend_at_seen"),
  ]);
  const threshold = Number((setRows || [])[0]?.value) || 95;
  const cl: any[] = clients || [];
  const cs: any[] = camps || [];
  const seenMap = new Map<string, any>(((seenRows as any[]) || []).map((x) => [x.campaign_id, x]));
  const [ranges, goals, adsets, recent] = await secondP;

  // a campaign is running now only if: it is ON, not past its stop date, has a live ad set,
  // and it delivered in the last 3 days (or just started). Abandoned or finished campaigns are left out.
  const nowMs = Date.now();
  const liveSets = new Set((adsets as any[]).map((a) => a.campaign_id));
  const delivered = new Set((recent as any[]).map((r) => r.entity_id));
  const running = (k: any): boolean => {
    if (String(k.effective_status || "") !== "ACTIVE") return false;
    if (k.stop_time && new Date(k.stop_time).getTime() <= nowMs) return false;
    if (!liveSets.has(k.id)) return false;
    const fresh = k.start_time && nowMs - new Date(k.start_time).getTime() < 3 * 864e5;
    return delivered.has(k.id) || !!fresh;
  };

  // sync health (popup) and failed syncs
  const failed = new Map<string, string>();
  for (const l of (logs || []) as any[]) if (l.client_id && !l.ok && !failed.has(l.client_id)) failed.set(l.client_id, l.detail || "");
  const okRecent = new Set((logs || []).filter((l: any) => l.ok && l.client_id).map((l: any) => l.client_id));
  const healthRows = cl.map((c) => {
    const stale = !c.synced_at || Date.now() - new Date(c.synced_at).getTime() > 60 * 60 * 1000;
    return { name: c.name, ago: ago(c.synced_at), stale, error: failed.has(c.id) && !okRecent.has(c.id) ? (failed.get(c.id) || "Sync failed").slice(0, 90) : "" };
  });
  const healthStatus: "ok" | "warn" | "bad" = healthRows.some((r) => r.error) ? "bad" : healthRows.some((r) => r.stale) ? "warn" : "ok";

  // ---- every campaign of this month, per client ----
  let tracked = 0, onTrack = 0, lateCount = 0, noTargetCount = 0; // counts kept for later use
  const groups: Group[] = [];
  for (const c of cl) {
    const g: Group = { client: c, notes: [], rows: [], noTarget: [] };
    if (c.account_status && c.account_status !== "active") g.notes.push({ level: "bad", text: ACCOUNT_HINT[String(c.account_status)] || `Account status: ${c.account_status}` });
    if (failed.has(c.id) && !okRecent.has(c.id)) g.notes.push({ level: "warn", text: `Sync failed: ${(failed.get(c.id) || "").slice(0, 90)}` });
    if (!c.period_start || !c.period_end) g.notes.push({ level: "warn", text: "No period set" });

    if (c.period_start) {
      for (const k of cs.filter((x) => x.client_id === c.id)) {
        const r = ranges.find((x: any) => x.entity_id === k.id && x.date_from === c.period_start);
        const spend = r ? Number(r.spend) : 0;
        const goal = goals.find((x: any) => x.campaign_id === k.id && x.period_start === c.period_start);
        const hasGoal = !!goal && (goal.target != null || goal.budget != null);
        const isActive = running(k);
        // only campaigns that are running now: stopped ones are not tracked here
        if (!isActive || !(spend > 0 || hasGoal)) continue;

        if (!goal || goal.target == null || Number(goal.target) <= 0) {
          if (spend > RUNNING_SPEND) { g.noTarget.push(k); noTargetCount++; }
          continue;
        }
        const p = computeProgress({
          type: k.type, periodStart: campaignStart(c.period_start, k.start_time, c.period_end), periodEnd: c.period_end, today,
          result: r ? Number(r.results) : 0, spend,
          goalTarget: Number(goal.target), goalBudget: goal.budget != null ? Number(goal.budget) : null, threshold,
        });
        tracked++;
        const late = p.status === "late" || p.status === "missed";
        // marked as seen: counts as handled until the campaign's spend changes (or the period changes)
        const sn = seenMap.get(k.id);
        const seen = late && !!sn && sn.period_start === c.period_start && spend <= Number(sn.spend_at_seen) + 0.005;
        if (late) lateCount++; else onTrack++;
        const res = r ? Number(r.results) : 0;
        g.rows.push({ camp: k, p, spend, late, seen, ratio: p.expected && p.expected > 0 ? res / p.expected : 1 });
      }
    }
    // problems first, the worst on top
    const sev = (x: Row) => (x.late && !x.seen ? (x.p.status === "missed" ? 0 : 1) : 2);
    g.rows.sort((a, b) => sev(a) - sev(b) || a.ratio - b.ratio);
    if (g.notes.length || g.rows.length || g.noTarget.length) groups.push(g);
  }
  // clients with the most serious problems first
  // account problems first, then by how far behind the worst campaign is
  const worst = (g: Group) => Math.min(2, ...g.rows.filter((x) => x.late && !x.seen).map((x) => (x.p.status === "missed" ? -1 : x.ratio)));
  const acct = (g: Group) => (g.notes.some((n) => n.level === "bad") ? 0 : 1);
  groups.sort((a, b) => acct(a) - acct(b) || worst(a) - worst(b) || a.client.name.localeCompare(b.client.name));

  const cards: OvCard[] = groups.map((g) => {
    const c = g.client;
    const left = c.period_end ? Math.max(0, Math.round((Date.parse(c.period_end) - Date.parse(today)) / 864e5)) : null;
    const late = g.rows.filter((x) => x.late && !x.seen);
    const ok = g.rows.length - late.length;
    const bad = g.notes.some((n) => n.level === "bad");
    const color = bad || late.some((x) => x.p.status === "missed" || x.ratio < 0.6) ? "var(--red)"
      : late.length || g.notes.length || g.noTarget.length ? "var(--orange)" : "var(--green)";
    const chips: OvCard["chips"] = [
      ...g.notes.map((n) => ({ text: n.text, tone: (n.level === "bad" ? "bad" : "warn") as "bad" | "warn" })),
      ...late.map((x) => {
        const seen = { campaignId: x.camp.id, periodStart: c.period_start as string, spend: x.spend };
        return x.p.status === "missed"
          ? { text: `${x.camp.name} · missed ${Math.round(x.p.pct || 0)}%`, tone: "bad" as const, seen }
          : { text: `${x.camp.name} · ${Math.round(x.ratio * 100)}%`, tone: (x.ratio < 0.6 ? "bad" : "warn") as "bad" | "warn", seen };
      }),
      ...(g.noTarget.length ? [{ text: `${g.noTarget.length} no target`, tone: "mute" as const }] : []),
    ];
    return {
      id: c.id, name: c.name, left: left === null ? "No period" : left === 0 ? "Ends today" : `${left} days left`,
      ring: g.rows.length ? Math.round((ok / g.rows.length) * 100) : 0, ringText: g.rows.length ? `${ok}/${g.rows.length}` : "—",
      color, count: g.rows.length + g.noTarget.length, chips,
      late: late.length > 0, account: g.notes.some((n) => n.level === "bad"), noTarget: g.noTarget.length > 0,
    };
  });

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Overview</div><div className="sub">{today}</div></div>
        <DataHealth status={healthStatus} rows={healthRows} />
      </div>

      {cl.length === 0 ? (
        <div className="panel empty"><b>No clients yet</b><Link href="/clients" style={{ color: "var(--blue2)" }}>Add your first client</Link></div>
      ) : (
        <>
          <OverviewGrid cards={cards} />
        </>
      )}
    </>
  );
}
