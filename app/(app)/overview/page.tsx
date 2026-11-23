import type React from "react";
import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { todayStr } from "@/lib/dates";
import { campaignStart, computeProgress, type Progress } from "@/lib/progress";
import { fetchAll } from "@/lib/fetchall";
import { TYPE_LABEL } from "@/lib/results";
import DataHealth from "@/components/DataHealth";
import SeenButton from "@/components/SeenButton";

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

  const [{ data: clients }, { data: setRows }, { data: camps }, { data: logs }, { data: seenRows }] = await Promise.all([
    sb.from("clients").select("id,name,period_start,period_end,account_status,synced_at").order("name"),
    sb.from("settings").select("key,value").eq("key", "late_threshold"),
    sb.from("campaigns").select("id,client_id,name,type,effective_status,start_time"),
    sb.from("sync_log").select("client_id,ok,detail,created_at").gte("created_at", dayAgo).order("created_at", { ascending: false }).limit(200),
    sb.from("attention_seen").select("campaign_id,period_start,spend_at_seen"),
  ]);
  const threshold = Number((setRows || [])[0]?.value) || 95;
  const cl: any[] = clients || [];
  const cs: any[] = camps || [];
  const seenMap = new Map<string, any>(((seenRows as any[]) || []).map((x) => [x.campaign_id, x]));
  const campIds = cs.map((k) => k.id);
  const [ranges, goals] = campIds.length
    ? await Promise.all([
        fetchAll<any>((a, b) => sb.from("insights_range").select("entity_id,date_from,spend,results").eq("level", "campaign").in("entity_id", campIds).order("synced_at", { ascending: false }).order("id", { ascending: false }).range(a, b) as any),
        fetchAll<any>((a, b) => sb.from("campaign_goals").select("campaign_id,period_start,target,budget").in("campaign_id", campIds).range(a, b) as any),
      ])
    : [[], []];

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
        const isActive = String(k.effective_status || "") === "ACTIVE";
        // same rule as Performance: it spent this period, or it is active with a goal (waiting for its first spend)
        if (!(spend > 0 || (hasGoal && isActive))) continue;

        if (!goal || goal.target == null || Number(goal.target) <= 0) {
          if (isActive && spend > RUNNING_SPEND) { g.noTarget.push(k); noTargetCount++; }
          continue;
        }
        const p = computeProgress({
          type: k.type, periodStart: campaignStart(c.period_start, k.start_time, c.period_end), periodEnd: c.period_end, today,
          result: r ? Number(r.results) : 0, spend,
          goalTarget: Number(goal.target), goalBudget: goal.budget != null ? Number(goal.budget) : null, threshold,
        });
        tracked++;
        const late = p.status === "late" || p.status === "missed";
        // marked as seen: no longer counts as a problem until the campaign's spend changes (or the period changes)
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
  const badRows = (g: Group) => g.rows.filter((x) => x.late && !x.seen).length;
  const score = (g: Group) => (g.notes.some((n) => n.level === "bad") ? 0 : badRows(g) ? 1 : g.notes.length || g.noTarget.length ? 2 : 3);
  groups.sort((a, b) => score(a) - score(b) || badRows(b) - badRows(a));

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
          {groups.map((g) => {
            const c = g.client;
            const total = c.period_start && c.period_end ? Math.max(1, Math.round((Date.parse(c.period_end) - Date.parse(c.period_start)) / 864e5) + 1) : 0;
            const elapsed = total ? Math.min(total, Math.max(0, Math.round((Date.parse(today) - Date.parse(c.period_start)) / 864e5) + 1)) : 0;
            const left = c.period_end ? Math.max(0, Math.round((Date.parse(c.period_end) - Date.parse(today)) / 864e5)) : null;
            const nBad = badRows(g);
            const tone = g.notes.some((n) => n.level === "bad") || nBad ? "var(--red)" : g.notes.length || g.noTarget.length ? "var(--orange)" : "var(--green)";
            const pct = total ? Math.round((elapsed / total) * 100) : 0;
            return (
              <div className="ovc" key={c.id}>
                <Link href={`/performance?client=${c.id}`} className="hd">
                  <span className="who">
                    <span className="ring" style={{ "--p": pct, "--c": tone } as React.CSSProperties}><i>{total ? `${pct}%` : "—"}</i></span>
                    <span style={{ minWidth: 0 }}><b>{c.name}</b><small>{left === null ? "No period" : left === 0 ? "Ends today" : `${left} days left`}</small></span>
                  </span>
                  <span className="cnt">{g.rows.length} campaign{g.rows.length === 1 ? "" : "s"}</span>
                </Link>

                {(g.notes.length > 0 || g.noTarget.length > 0) && (
                  <div className="chips">
                    {g.notes.map((n, i) => <span key={i} className={`chip sm ${n.level === "bad" ? "bad" : "warn"}`}>{n.text}</span>)}
                    {g.noTarget.length > 0 && <span className="chip sm mute">{g.noTarget.length} no target</span>}
                  </div>
                )}

                {g.rows.map((x) => {
                  const got = Math.min(100, x.p.pct || 0);
                  const should = x.p.expected && x.p.target ? Math.min(100, (x.p.expected / x.p.target) * 100) : null;
                  const bad = x.late && !x.seen;
                  return (
                    <div className="camp" key={x.camp.id}>
                      <div className="l1">
                        <span className="nm" title={x.camp.name}>{x.camp.name}<em>{TYPE_LABEL[x.camp.type as keyof typeof TYPE_LABEL]}</em></span>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className="st" style={{ color: bad ? "var(--red)" : x.late ? "var(--t3)" : "var(--green)" }}>{x.p.status === "missed" ? "missed" : x.late ? (x.seen ? "seen" : "late") : x.p.status === "achieved" ? "achieved" : "on track"}</span>
                          {bad && <SeenButton campaignId={x.camp.id} periodStart={c.period_start} spend={x.spend} />}
                        </span>
                      </div>
                      <div className={`pace ${bad ? "bad" : x.late ? "mute" : ""}`}>
                        <b style={{ width: `${got}%` }} />
                        {should !== null && <u style={{ left: `calc(${should}% - 1px)` }} />}
                      </div>
                      <div className="l2"><span>{Math.round(x.p.pct || 0)}% of target</span>{should !== null && <span>should be {Math.round(should)}%</span>}</div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {groups.length === 0 && <div className="panel"><div className="fnd ok"><b>No campaigns to show</b></div></div>}
        </>
      )}
    </>
  );
}
