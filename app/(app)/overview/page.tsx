import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { addDays, daysLeft, todayStr } from "@/lib/dates";
import { campaignStart, computeProgress } from "@/lib/progress";
import { fetchAll } from "@/lib/fetchall";
import { TYPE_LABEL, cprValue } from "@/lib/results";
import YesterdayStrip, { type YClient } from "@/components/YesterdayStrip";
import DataHealth from "@/components/DataHealth";
import SeenButton from "@/components/SeenButton";
import WatchLine from "@/components/WatchLine";
import { loadWatch, type WatchRow } from "@/lib/watch";
import { addQuickNote } from "./actions";

export const dynamic = "force-dynamic";
const MIN_RUNNING = 0.5; // an active campaign must spend more than this per day to count as running

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
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

type Item = { level: "bad" | "warn"; client: string; clientId: string; text: string; seen?: { campaignId: string; periodStart: string; spend: number } };

export default async function OverviewPage() {
  const sb = createServerSupabase();
  const today = todayStr();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const [{ data: clients }, { data: setRows }, { data: camps }, { data: logs }, { data: orders }, { data: todayOrders }, { data: tasks }, { data: notes }, spendToday, { count: readyPosts }] = await Promise.all([
    sb.from("clients").select("id,name,period_start,period_end,budget,account_status,synced_at,alert_limits").order("name"),
    sb.from("settings").select("key,value").eq("key", "late_threshold"),
    sb.from("campaigns").select("id,client_id,name,type,effective_status,start_time"),
    sb.from("sync_log").select("client_id,ok,detail,created_at").gte("created_at", dayAgo).order("created_at", { ascending: false }).limit(200),
    Promise.resolve({ data: null as any }),
    sb.from("crm_orders").select("id,client_id").eq("day", today),
    sb.from("tasks").select("id,title,priority,due_date,client_id").eq("status", "pending").order("due_date", { ascending: true, nullsFirst: false }).limit(20),
    sb.from("notes").select("id,body,created_at").order("created_at", { ascending: false }).limit(3),
    sb.from("insights_daily").select("spend").eq("level", "campaign").eq("day", today).then((r: any) => r.data || []),
    sb.from("posts").select("id", { count: "exact", head: true }).eq("status", "ready").eq("hidden", false),
  ]);
  const threshold = Number((setRows || [])[0]?.value) || 95;
  const cl: any[] = clients || [];
  const yDay = addDays(today, -1);
  const watchRows: WatchRow[] = await loadWatch(sb, today, false).catch(() => []);
  const { data: yRows } = await sb.from("insights_daily").select("entity_id,client_id,day,spend,results").eq("level", "campaign")
    .gte("day", addDays(today, -4)).lte("day", yDay);
  const cs: any[] = camps || [];
  const { data: seenRows } = await sb.from("attention_seen").select("campaign_id,period_start,spend_at_seen");
  const seenMap = new Map<string, any>(((seenRows as any[]) || []).map((x) => [x.campaign_id, x]));
  const nameOf = new Map(cl.map((c) => [c.id, c.name]));

  const campIds = cs.map((k) => k.id);
  const [ranges, goals] = campIds.length
    ? await Promise.all([
        fetchAll<any>((a, b) => sb.from("insights_range").select("entity_id,date_from,spend,results").eq("level", "campaign").in("entity_id", campIds).order("synced_at", { ascending: false }).order("id", { ascending: false }).range(a, b) as any),
        fetchAll<any>((a, b) => sb.from("campaign_goals").select("campaign_id,period_start,target,budget").in("campaign_id", campIds).range(a, b) as any),
      ])
    : [[], []];

  // ---- تقدم كل حملة لها هدف ----
  const risky: { client: any; camp: any; p: ReturnType<typeof computeProgress>; spend: number }[] = [];
  const endingSoon: Item[] = [];
  for (const c of cl) {
    for (const k of cs.filter((x) => x.client_id === c.id)) {
      const g = goals.find((x: any) => x.campaign_id === k.id && x.period_start === c.period_start);
      if (!g || !c.period_start) continue;
      const r = ranges.find((x: any) => x.entity_id === k.id && x.date_from === c.period_start);
      const p = computeProgress({
        type: k.type, periodStart: campaignStart(c.period_start, k.start_time, c.period_end), periodEnd: c.period_end, today,
        result: r ? Number(r.results) : 0, spend: r ? Number(r.spend) : 0,
        goalTarget: g.target != null ? Number(g.target) : null, goalBudget: g.budget != null ? Number(g.budget) : null, threshold,
      });
      if (p.status === "late" || p.status === "missed") risky.push({ client: c, camp: k, p, spend: r ? Number(r.spend) : 0 });
    }
  }

  // ---- Yesterday strip: yesterday vs the 3 days before it, per campaign ----
  const yClients: YClient[] = [];
  for (const c of cl) {
    const camps2: YClient["campaigns"] = [];
    let spendTotal = 0, worse = false, better = false, stop = false, over = false;
    for (const k of cs.filter((x) => x.client_id === c.id)) {
      // only days inside the client's current period count
      const mine = ((yRows || []) as any[]).filter((r) => r.entity_id === k.id && (!c.period_start || r.day >= c.period_start));
      const y = mine.filter((r) => r.day === yDay), p3 = mine.filter((r) => r.day !== yDay);
      const sum = (a: any[], f: string) => a.reduce((t, r) => t + Number(r[f] || 0), 0);
      const ys = sum(y, "spend"), yr = sum(y, "results"), ps = sum(p3, "spend"), pr = sum(p3, "results");
      // A campaign counts as running when it is ACTIVE and spent more than $0.50
      const active = k.effective_status === "ACTIVE";
      if (ys <= 0 && !(active && ps > 0)) continue;           // paused / finished campaigns stay hidden
      const cost = cprValue(k.type, ys, yr), prev = cprValue(k.type, ps, pr);
      const stopped = active && ys < MIN_RUNNING;
      // With a cost limit (set in the client file) the change is measured against that limit, not the previous days:
      // under the limit is fine whatever the daily price swings. Without a limit it falls back to the previous 3 days.
      const lim = Number(c.alert_limits?.[k.type]) || 0;
      const delta = cost === null ? null : lim > 0 ? (cost / lim - 1) * 100 : prev ? (cost / prev - 1) * 100 : null;
      const isOver = !stopped && cost !== null && lim > 0 && cost > lim;
      if (stopped) { if (ys > 0) stop = true; }   // spending almost nothing is a warning; no spend at all is just stopped (grey)
      else if (lim > 0) { if (isOver) { if (delta !== null && delta > 10) worse = true; else over = true; } else if (delta !== null && delta < -10) better = true; }
      else if (delta !== null && delta > 10) worse = true; else if (delta !== null && delta < -10) better = true;
      spendTotal += ys;
      camps2.push({
        name: k.name, type: TYPE_LABEL[k.type as keyof typeof TYPE_LABEL], spend: ys, results: yr, stopped, delta, over: isOver,
        limit: lim > 0 ? "$" + (lim < 0.01 ? lim.toFixed(3) : lim.toFixed(2)) + (k.type === "reach" ? " /1K" : "") : null,
        cost: cost === null ? "—" : "$" + (cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)) + (k.type === "reach" ? " /1K" : " per result"),
      });
    }
    const running = !c.period_start || !c.period_end || (c.period_start <= yDay && c.period_end >= yDay);
    if (camps2.length === 0) {
      if (running && c.account_status === "active") yClients.push({ id: c.id, name: c.name, spend: 0, flag: "idle", campaigns: [] });
      continue;
    }
    camps2.sort((a, b) => b.spend - a.spend);
    yClients.push({ id: c.id, name: c.name, spend: spendTotal, flag: stop ? "stop" : worse ? "worse" : over ? "over" : better ? "better" : spendTotal <= 0 ? "idle" : "same", campaigns: camps2 });
  }
  const yRank = { stop: 0, worse: 1, over: 2, same: 3, better: 4, idle: 5 } as const;
  yClients.sort((a, b) => yRank[a.flag] - yRank[b.flag] || b.spend - a.spend);
  const yLabel = new Date(yDay + "T00:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

  // ---- العدّادات ----
  const active = cl.filter((c) => c.account_status === "active").length;
  const disabled = cl.filter((c) => c.account_status && c.account_status !== "active");
  const finished = cl.filter((c) => c.period_end && c.period_end < today);
  const ordersToday = (todayOrders || []).length;
  const ordersByClient = new Map<string, number>();
  for (const o of (todayOrders || []) as any[]) ordersByClient.set(o.client_id, (ordersByClient.get(o.client_id) || 0) + 1);
  const orderRows = [...ordersByClient.entries()].sort((a, b) => b[1] - a[1]);
  const spendTodayTotal = (spendToday as any[]).reduce((s, r) => s + Number(r.spend), 0);

  // ---- ما يحتاج انتباهاً ----
  const items: Item[] = [];
  for (const c of disabled) items.push({ level: "bad", client: c.name, clientId: c.id, text: ACCOUNT_HINT[String(c.account_status)] || `Account status: ${c.account_status}` });
  for (const x of risky) {
    // marked as seen: stay hidden until the campaign's spend changes (or the period changes)
    const sn = seenMap.get(x.camp.id);
    if (sn && sn.period_start === x.client.period_start && x.spend <= Number(sn.spend_at_seen) + 0.005) continue;
    items.push({
      seen: { campaignId: x.camp.id, periodStart: x.client.period_start, spend: x.spend },
      level: "bad", client: x.client.name, clientId: x.client.id,
      text: `${x.camp.name} (${TYPE_LABEL[x.camp.type as keyof typeof TYPE_LABEL]}) ${x.p.status === "missed" ? "missed" : "late"}: ${Math.round(x.p.pct || 0)}% of target`,
    });
  }
  const failed = new Map<string, string>();
  for (const l of (logs || []) as any[]) if (l.client_id && !l.ok && !failed.has(l.client_id)) failed.set(l.client_id, l.detail || "");
  const okRecent = new Set((logs || []).filter((l: any) => l.ok && l.client_id).map((l: any) => l.client_id));
  for (const [id, d] of failed) if (!okRecent.has(id)) items.push({ level: "warn", client: nameOf.get(id) || "—", clientId: id, text: `Sync failed: ${d.slice(0, 90)}` });
  for (const c of cl) {
    const d = daysLeft(c.period_end, today);
    if (c.period_end && c.period_end >= today && d !== null && d <= 3) {
      endingSoon.push({ level: "warn", client: c.name, clientId: c.id, text: d === 0 ? "Period ends today" : `Period ends in ${d}d` });
    }
    if (!c.period_start || !c.period_end) items.push({ level: "warn", client: c.name, clientId: c.id, text: "No period set" });
  }
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));

  // ---- Data health (shown in a popup) ----
  const healthRows = cl.map((c) => {
    const stale = !c.synced_at || Date.now() - new Date(c.synced_at).getTime() > 60 * 60 * 1000;
    return { name: c.name, ago: ago(c.synced_at), stale, error: failed.has(c.id) && !okRecent.has(c.id) ? (failed.get(c.id) || "Sync failed").slice(0, 90) : "" };
  });
  const healthStatus: "ok" | "warn" | "bad" = healthRows.some((r) => r.error) ? "bad" : healthRows.some((r) => r.stale) ? "warn" : "ok";

  const tile = (l: string, v: number | string, tone?: "bad" | "ok") => (
    <div className="kpi" key={l}>
      <div className="l">{l}</div>
      <div className="v" style={tone === "bad" && Number(v) > 0 ? { color: "var(--red)" } : undefined}>{v}</div>
          </div>
  );
  const link = (it: Item) => <Link href={`/performance?client=${it.clientId}`}><b>{it.client}</b></Link>;

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Overview</div><div className="sub">{today} </div></div>
        <DataHealth status={healthStatus} rows={healthRows} />
      </div>

      {cl.length === 0 ? (
        <div className="panel empty"><b>No clients yet</b><Link href="/clients" style={{ color: "var(--blue2)" }}>Add your first client</Link></div>
      ) : (
        <>
          <div className="tiles">
            {tile("Total Clients", cl.length)}
            {tile("Active Accounts", active)}
            {tile("Disabled", disabled.length, "bad")}
            {tile("Finished", finished.length)}
            {tile("Ready Posts", readyPosts || 0)}
            {tile("Today's Orders", ordersToday)}
            {tile("Goal At Risk", risky.length, "bad")}
          </div>

          <YesterdayStrip label={yLabel} clients={yClients} />

          <div className="ov3c">
            <div className="panel">
              <h3>Needs Attention</h3>
              {items.length === 0 ? (
                <div className="fnd ok"><b>All good</b></div>
              ) : (
                <div className="diag">
                  {items.slice(0, 12).map((it, i) => (
                    <div className={`fnd ${it.level}`} key={i}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                        {link(it)}<span style={{ display: "flex", gap: 6, alignItems: "center" }}><span className={`chip sm ${it.level === "bad" ? "bad" : "warn"}`}>{it.level === "bad" ? "critical" : "warning"}</span>{it.seen && <SeenButton {...it.seen} />}</span>
                      </div>
                      <div className="c" dir="auto">{it.text}</div>
                    </div>
                  ))}
                  {items.length > 12 && <div className="sub">+{items.length - 12} more</div>}
                </div>
              )}
            </div>

            <div className="panel">
              <h3 style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Watch</span>
                <Link href="/watch" style={{ color: "var(--blue2)", fontSize: 12, fontWeight: 600 }}>All</Link>
              </h3>
              {watchRows.length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>—</div> : watchRows.slice(0, 8).map((r) => <WatchLine key={r.id} r={r} />)}
              {watchRows.length > 8 && <div className="sub">+{watchRows.length - 8} more</div>}
            </div>

            <div className="col">
              <div className="panel">
                <h3>Orders Today</h3>
                {orderRows.length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>—</div> : orderRows.map(([id, n]) => (
                  <div key={id} style={{ marginTop: 10 }}>
                    <div className="dsum" style={{ cursor: "default", border: 0, padding: 0 }}><span>{nameOf.get(id) || ""}</span><b>{n}</b></div>
                    <div className="bar"><i style={{ width: `${(n / orderRows[0][1]) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>Ending Soon</h3>
                {endingSoon.length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>—</div> : endingSoon.map((it, i) => (
                  <div className="dsum" key={i}><span>{link(it)}</span><span className={`chip sm ${it.text.includes("today") ? "bad" : "warn"}`}>{it.text.replace("Period ends ", "")}</span></div>
                ))}
              </div>
              <div className="panel">
                <h3>Tasks</h3>
                {(tasks || []).length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>—</div> : (tasks as any[]).slice(0, 5).map((t) => (
                  <div className="dsum" key={t.id} style={{ cursor: "default" }}>
                    <span>{t.title}</span><span className={`chip sm ${t.priority === "high" ? "bad" : "mute"}`}>{t.due_date || t.priority}</span>
                  </div>
                ))}
              </div>
              <div className="panel">
                <h3>Quick Note</h3>
                <form action={addQuickNote}>
                  <textarea name="body" rows={3} placeholder="Write a note…" style={{ width: "100%" }} />
                  <button className="btn pri" style={{ marginTop: 6 }} type="submit">Save</button>
                </form>
                {(notes || []).map((n: any) => <div className="dsum" key={n.id} style={{ cursor: "default" }}><span>{n.body.slice(0, 90)}</span></div>)}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
