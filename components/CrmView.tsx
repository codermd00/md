"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { writeCid } from "@/lib/cid-client";
import LineChart, { type Series } from "./LineChart";
import { GOVERNORATES, UNKNOWN_GOV } from "@/lib/governorates";
import { deleteOrder, setOrderGovernorate } from "@/app/(app)/crm/actions";

export type OrderRow = { id: string; phone: string; day: string; address: string; governorate: string; adId: string };
export type GovRow = { name: string; orders: number; share: number; spend: number | null; costOrder: number | null };
export type DayRow = { day: string; orders: number; msgs: number };
export type Health = { url: string; lastEvent: string | null; events24h: number; problems: { kind: string; error: string; at: string; entryId?: string; object?: string }[] };
type Kpi = { metaMsgs: number; metaLeads: number; costLead: number | null; convs: number; orders: number; spend: number; rate: number | null; costOrder: number | null; hasMsgCampaigns: boolean };

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "Now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const RANGES = [["today", "Today"], ["7", "7 days"], ["30", "30 days"], ["period", "Period"]] as const;

export default function CrmView(p: {
  clients: { id: string; name: string }[]; client: { id: string; name: string } | null;
  range: string; from: string; to: string; orders: OrderRow[]; gov: GovRow[]; days: DayRow[]; kpi: Kpi | null;
  health: Health; govSpendNote: string; sync: { lastOk: string | null; failed: string };
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [metric, setMetric] = useState<"orders" | "cost" | "spend">("orders");
  const [, start] = useTransition();
  const go = (client: string, range: string) => { writeCid(client); router.push(`/crm?client=${client}&range=${range}`); };

  const shown = useMemo(() => p.orders.filter((o) =>
    (!filter || (o.governorate || UNKNOWN_GOV) === filter) && (!q || o.phone.includes(q) || o.address.includes(q))), [p.orders, filter, q]);

  const costs = p.gov.filter((g) => g.costOrder !== null && g.orders >= 3);
  const best = costs.length >= 2 ? costs.reduce((a, b) => (b.costOrder! < a.costOrder! ? b : a)) : null;
  const worst = costs.length >= 2 ? costs.reduce((a, b) => (b.costOrder! > a.costOrder! ? b : a)) : null;
  const hasEvents = !!p.health.lastEvent;

  const chartSeries: Series[] = [
    { name: "Orders", color: "#34c38f", fill: true, axis: "left", values: p.days.map((d) => d.orders) },
  ];

  const hp = p.health;
  const tone = !hasEvents ? "mute" : hp.problems.length ? "warn" : "ok";
  const healthPill = (
    <div style={{ position: "relative" }}>
      <span className={`chip ${tone}`} style={{ cursor: "pointer", padding: "7px 12px" }} onClick={() => setOpen(!open)} title="Webhook status">
        ● Webhook · {hasEvents ? ago(hp.lastEvent) : "nothing received"}{hp.problems.length ? ` · ${hp.problems.length} issue(s)` : ""}
      </span>
      {open && (
        <div className="panel pop" style={{ position: "absolute", top: "calc(100% + 6px)", insetInlineEnd: 0, width: 340, zIndex: 20, boxShadow: "0 8px 30px rgba(0,0,0,.18)" }}>
          <div className="kpi-in">
            <div><small>Last event</small><b>{ago(hp.lastEvent)}</b></div>
            <div><small>Events 24h</small><b>{hp.events24h}</b></div>
            <div><small>Issues</small><b style={hp.problems.length ? { color: "var(--red)" } : undefined}>{hp.problems.length}</b></div>
          </div>
          {hp.problems.map((x, i) => (
            <div className="fnd warn" key={i} style={{ marginTop: 8 }}>
              <b>{x.kind === "unmatched" ? "Unmatched page" : x.kind}</b>
              {x.entryId ? (
                <>
                  <div className="c" dir="ltr">{x.object === "instagram" ? "Instagram ID" : "Page ID"}: {x.entryId}</div>
                  
                </>
              ) : <div className="c" dir="auto">{x.error}</div>}
            </div>
          ))}
          {!hasEvents && (
            <div className="fnd warn" style={{ marginTop: 8 }}>
              <b>No events yet</b>
              <div className="c" dir="ltr" style={{ wordBreak: "break-all" }}>{hp.url || "(NEXT_PUBLIC_SUPABASE_URL not set)"}</div>
              
            </div>
          )}
        </div>
      )}
    </div>
  );

  // مخطط المحافظات
  const govBars = (() => {
    const rows = p.gov.map((g) => ({ ...g, v: metric === "orders" ? g.orders : metric === "spend" ? g.spend : g.costOrder }));
    const withV = rows.filter((r) => r.v !== null && r.v > 0);
    const sorted = [...rows].sort((a, b) => metric === "cost"
      ? (a.v === null ? 1 : b.v === null ? -1 : a.v - b.v) : (b.v || 0) - (a.v || 0)).slice(0, 12);
    const max = Math.max(...withV.map((r) => r.v as number), 0) || 1;
    return { rows: sorted, max };
  })();
  const fmtV = (v: number | null) => v === null ? "—" : metric === "orders" ? String(v) : money(v);

  if (!p.client) {
    return (<><div className="topbar"><div><div className="h1">CRM Messages</div></div></div>
      <div className="panel empty"><b>No clients yet</b>Add a client from Clients.</div></>);
  }

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <div className="h1" style={{ fontSize: 20 }}>CRM Messages</div>
          <div className="sub">{p.from} → {p.to}</div>
        </div>
        <div className="pbar">
          {healthPill}
          <select value={p.client.id} onChange={(e) => go(e.target.value, p.range)}>
            {p.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {RANGES.map(([k, l]) => <span key={k} className={`btab ${p.range === k ? "on" : ""}`} onClick={() => go(p.client!.id, k)}>{l}</span>)}
        </div>
      </div>

      {(p.sync.failed || !p.sync.lastOk) && (
        <div className="fnd warn" style={{ marginBottom: 12 }}>
          <b>{p.sync.failed ? "Last sync failed — showing last good data" : "Not synced yet"}</b>
          <div className="c" dir="auto">{p.sync.failed ? p.sync.failed.slice(0, 160) : ""}{p.sync.lastOk ? ` · last OK ${ago(p.sync.lastOk)}` : ""}</div>
        </div>
      )}

      {p.kpi && (
        <div className="kpis" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
          <div className="kpi"><div className="l">Orders (CRM)</div><div className="v">{num(p.kpi.orders)}</div></div>
          <div className="kpi"><div className="l">Meta messages</div><div className="v">{p.kpi.hasMsgCampaigns ? num(p.kpi.metaMsgs) : "—"}</div><div className="n">CRM: {num(p.kpi.convs)}</div></div>
          <div className="kpi"><div className="l">Meta leads</div><div className="v">{p.kpi.hasMsgCampaigns ? num(p.kpi.metaLeads) : "—"}</div><div className="n">{p.kpi.costLead !== null ? `CPL ${money(p.kpi.costLead)}` : ""}</div></div>
          <div className="kpi"><div className="l">Order rate</div><div className="v">{p.kpi.rate !== null ? p.kpi.rate.toFixed(1) + "%" : "—"}</div></div>
        </div>
      )}

      <div className="pgrid">
        <div className="panel">
          <h3>Orders per Day</h3>
          <LineChart labels={p.days.map((d) => d.day)} series={chartSeries} height={170} partialLast={p.to === p.days[p.days.length - 1]?.day && p.range !== "period"} />
        </div>
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div><h3>Governorates</h3></div>
            <div className="btabs" style={{ margin: 0 }}>
              {([["orders", "Orders"], ["cost", "Cost/order"], ["spend", "Spend"]] as const).map(([k, l]) => (
                <span key={k} className={`btab ${metric === k ? "on" : ""}`} onClick={() => setMetric(k)}>{l}</span>
              ))}
            </div>
          </div>
          {govBars.rows.length === 0 ? (
            <div className="empty" style={{ padding: 24 }}><b>No orders</b></div>
          ) : (
            <div className="gbars">
              {govBars.rows.map((g) => {
                const v = metric === "orders" ? g.orders : metric === "spend" ? g.spend : g.costOrder;
                const isBest = metric === "cost" && best && g.name === best.name, isWorst = metric === "cost" && worst && g.name === worst.name;
                return (
                  <div className="gb" key={g.name}>
                    <span className="gn">{g.name}</span>
                    <span className="gt"><i style={{ width: `${v ? Math.max(2, (v / govBars.max) * 100) : 0}%`, background: isBest ? "var(--green)" : isWorst ? "var(--red)" : undefined }} /></span>
                    <span className="gv">{fmtV(v)}{metric === "orders" ? <small> · {Math.round(g.share)}%</small> : null}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div><h3>Orders</h3><div className="sub">{shown.length} / {p.orders.length}{p.orders.length >= 300 ? "+" : ""}</div></div>
          <div className="pbar">
            <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170, padding: "7px 10px", fontSize: 13 }} />
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All governorates</option>
              {[...GOVERNORATES, UNKNOWN_GOV].map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        {shown.length === 0 ? <div className="sub">—</div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="bt stack">
              <thead><tr><th>Day</th><th>Phone</th><th>Governorate</th><th>Address</th><th></th></tr></thead>
              <tbody>
                {shown.slice(0, 100).map((o) => (
                  <tr key={o.id}>
                    <td>{o.day}</td><td dir="ltr">{o.phone}</td>
                    <td>
                      <select defaultValue={o.governorate} style={{ padding: "3px 6px", fontSize: 12, width: "auto" }}
                        onChange={(e) => start(async () => { await setOrderGovernorate(o.id, e.target.value); router.refresh(); })}>
                        <option value="">{UNKNOWN_GOV}</option>
                        {GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </td>
                    <td dir="auto" style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.address}>{o.address || "—"}</td>
                    <td><a style={{ color: "var(--red)", cursor: "pointer", fontSize: 12 }}
                      onClick={() => confirm("Delete this order?") && start(async () => { await deleteOrder(o.id); router.refresh(); })}>Delete</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
