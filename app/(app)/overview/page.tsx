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

type Row = { camp: any; p: Progress; spend: number; ratio: number };
type Group = { client: any; notes: { text: string; level: "bad" | "warn" }[]; late: Row[]; noTarget: any[] };

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
  let tracked = 0, onTrack = 0, lateCount = 0, noTargetCount = 0;
  const groups: Group[] = [];
  for (const c of cl) {
    const g: Group = { client: c, notes: [], late: [], noTarget: [] };
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
        if (p.status === "late" || p.status === "missed") {
          lateCount++;
          // marked as seen: hidden until the campaign's spend changes (or the period changes)
          const sn = seenMap.get(k.id);
          if (sn && sn.period_start === c.period_start && spend <= Number(sn.spend_at_seen) + 0.005) continue;
          const ratio = p.expected && p.expected > 0 ? (r ? Number(r.results) : 0) / p.expected : 0;
          g.late.push({ camp: k, p, spend, ratio });
        } else onTrack++;
      }
    }
    g.late.sort((a, b) => (a.p.status === b.p.status ? a.ratio - b.ratio : a.p.status === "missed" ? -1 : 1));
    if (g.notes.length || g.late.length || g.noTarget.length) groups.push(g);
  }
  // clients with the most serious problems first
  const score = (g: Group) => (g.notes.some((n) => n.level === "bad") ? 0 : g.late.length ? 1 : 2);
  groups.sort((a, b) => score(a) - score(b) || b.late.length - a.late.length);

  const fine = groups.length === 0;

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
          <div className="panel" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "baseline" }}>
              <span><b style={{ fontSize: 22 }}>{tracked}</b> <span className="sub" style={{ margin: 0 }}>tracked</span></span>
              <span><b style={{ fontSize: 22, color: "var(--green)" }}>{onTrack}</b> <span className="sub" style={{ margin: 0 }}>on track</span></span>
              <span><b style={{ fontSize: 22, color: lateCount ? "var(--red)" : undefined }}>{lateCount}</b> <span className="sub" style={{ margin: 0 }}>late</span></span>
              <span><b style={{ fontSize: 22 }}>{noTargetCount}</b> <span className="sub" style={{ margin: 0 }}>no target</span></span>
            </div>
          </div>

          {fine ? (
            <div className="panel"><div className="fnd ok"><b>{lateCount ? "Nothing new needs attention" : "All campaigns are on track"}</b></div></div>
          ) : groups.map((g) => (
            <div className="panel" key={g.client.id} style={{ marginBottom: 14 }}>
              <h3 style={{ display: "flex", justifyContent: "space-between" }}>
                <Link href={`/performance?client=${g.client.id}`}>{g.client.name}</Link>
                <span className="sub" style={{ margin: 0 }}>{g.client.period_end && g.client.period_end >= today ? `${Math.max(0, Math.round((Date.parse(g.client.period_end) - Date.parse(today)) / 864e5))}d left` : ""}</span>
              </h3>

              {g.notes.map((n, i) => (
                <div className={`fnd ${n.level}`} key={i} style={{ marginBottom: 8 }}><div className="c" dir="auto">{n.text}</div></div>
              ))}

              <div className="plist">
                {g.late.map((x) => {
                  const days = x.p.total ? Math.min(100, (x.p.elapsed / x.p.total) * 100) : 0;
                  const got = Math.min(100, x.p.pct || 0);
                  return (
                    <div className="prow" key={x.camp.id}>
                      <div className="top">
                        <div className="nm" title={x.camp.name}>{x.camp.name}<span className="tp">{TYPE_LABEL[x.camp.type as keyof typeof TYPE_LABEL]}</span></div>
                        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span className="chip sm bad">{x.p.status === "missed" ? "missed" : "late"}</span>
                          <SeenButton campaignId={x.camp.id} periodStart={g.client.period_start} spend={x.spend} />
                        </span>
                      </div>
                      <div className="meta"><span>Days <b>{Math.round(days)}%</b></span></div>
                      <div className="bar"><i style={{ width: `${days}%`, opacity: 0.45 }} /></div>
                      <div className="meta"><span>Target <b>{Math.round(x.p.pct || 0)}%</b>{x.p.expected && x.p.target ? ` · expected ${Math.round((x.p.expected / x.p.target) * 100)}%` : ""}</span></div>
                      <div className="bar"><i style={{ width: `${got}%`, background: "var(--red)" }} /></div>
                    </div>
                  );
                })}
              </div>

              {g.noTarget.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div className="sub" style={{ marginBottom: 4 }}>No target set</div>
                  {g.noTarget.map((k) => (
                    <div className="dsum" key={k.id} style={{ cursor: "default" }}>
                      <span>{k.name}</span><span className="chip sm mute">{TYPE_LABEL[k.type as keyof typeof TYPE_LABEL]}</span>
                    </div>
                  ))}
                  <Link href={`/performance?client=${g.client.id}`} style={{ color: "var(--blue2)", fontSize: 12, fontWeight: 600 }}>Set targets</Link>
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </>
  );
}
