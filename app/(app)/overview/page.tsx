import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { daysLeft, todayStr } from "@/lib/dates";
import { computeProgress } from "@/lib/progress";
import { fetchAll } from "@/lib/fetchall";
import { TYPE_LABEL } from "@/lib/results";
import { addQuickNote } from "./actions";

export const dynamic = "force-dynamic";

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

type Item = { level: "bad" | "warn"; client: string; clientId: string; text: string };

export default async function OverviewPage() {
  const sb = createServerSupabase();
  const today = todayStr();
  const dayAgo = new Date(Date.now() - 86400000).toISOString();

  const [{ data: clients }, { data: setRows }, { data: camps }, { data: logs }, { data: orders }, { data: todayOrders }, { data: tasks }, { data: notes }, spendToday, { count: readyPosts }] = await Promise.all([
    sb.from("clients").select("id,name,period_start,period_end,budget,account_status,synced_at").order("name"),
    sb.from("settings").select("key,value").eq("key", "late_threshold"),
    sb.from("campaigns").select("id,client_id,name,type"),
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
  const cs: any[] = camps || [];
  const nameOf = new Map(cl.map((c) => [c.id, c.name]));

  const campIds = cs.map((k) => k.id);
  const [ranges, goals] = campIds.length
    ? await Promise.all([
        fetchAll<any>((a, b) => sb.from("insights_range").select("entity_id,date_from,spend,results").eq("level", "campaign").in("entity_id", campIds).range(a, b) as any),
        fetchAll<any>((a, b) => sb.from("campaign_goals").select("campaign_id,period_start,target,budget").in("campaign_id", campIds).range(a, b) as any),
      ])
    : [[], []];

  // ---- تقدم كل حملة لها هدف ----
  const risky: { client: any; camp: any; p: ReturnType<typeof computeProgress> }[] = [];
  const endingSoon: Item[] = [];
  for (const c of cl) {
    for (const k of cs.filter((x) => x.client_id === c.id)) {
      const g = goals.find((x: any) => x.campaign_id === k.id && x.period_start === c.period_start);
      if (!g || !c.period_start) continue;
      const r = ranges.find((x: any) => x.entity_id === k.id && x.date_from === c.period_start);
      const p = computeProgress({
        type: k.type, periodStart: c.period_start, periodEnd: c.period_end, today,
        result: r ? Number(r.results) : 0, spend: r ? Number(r.spend) : 0,
        goalTarget: g.target != null ? Number(g.target) : null, goalBudget: g.budget != null ? Number(g.budget) : null, threshold,
      });
      if (p.status === "late" || p.status === "missed") risky.push({ client: c, camp: k, p });
    }
  }

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
    items.push({
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

          <div className="ov2">
            <div className="col">
              <div className="panel grow">
                <h3>Needs Attention</h3>
                {items.length === 0 ? (
                  <div className="fnd ok"><b>All good</b></div>
                ) : (
                  <div className="diag">
                    {items.slice(0, 12).map((it, i) => (
                      <div className={`fnd ${it.level}`} key={i}>{link(it)}<div className="c" dir="auto">{it.text}</div></div>
                    ))}
                    {items.length > 12 && <div className="sub">+{items.length - 12} more</div>}
                  </div>
                )}
              </div>
            </div>

            <div className="col">
              <div className="panel">
                <h3>Ending Soon</h3>
                {endingSoon.length === 0 ? <div className="sub" style={{ marginBottom: 0 }}>—</div> : endingSoon.map((it, i) => (
                  <div className="dsum" key={i}><span>{link(it)}</span><span className="c">{it.text}</span></div>
                ))}
              </div>

              <div className="panel">
            <h3>Orders Today</h3>
            {orderRows.length === 0 ? <div className="sub">—</div> : orderRows.map(([id, n]) => (
              <div className="dsum" key={id} style={{ cursor: "default" }}>
                <span>{nameOf.get(id) || ""}</span><b>{n}</b>
              </div>
            ))}
          </div>

              <div className="panel grow">
                <h3>Data Health</h3>
                {cl.map((c) => {
                  const stale = !c.synced_at || Date.now() - new Date(c.synced_at).getTime() > 60 * 60 * 1000;
                  return (
                    <div className="dsum" key={c.id} style={{ cursor: "default" }}>
                      <span>{c.name}</span>
                      <span className={`chip sm ${stale ? "warn" : "ok"}`}>{ago(c.synced_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="ov3">
            <div className="panel">
              <h3>Tasks</h3>
              {(tasks || []).length === 0 ? <div className="sub">—</div> : (tasks as any[]).slice(0, 5).map((t) => (
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
        </>
      )}
    </>
  );
}
