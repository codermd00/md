"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { loadPostResults, type PostResultRow, type PostResultsOut } from "@/app/(app)/content/results-actions";
import { deleteMonthOrder, loadMonthOrders, saveMonthOrder, type MonthOrder } from "@/app/(app)/content/review-actions";
import { TYPE_LABEL } from "@/lib/results";

const GOAL: Record<string, string> = { sales: "Sales", followers: "Followers", awareness: "Awareness", other: "Other" };
const GOAL_ORDER: Record<string, number> = { sales: 0, followers: 1, awareness: 2, other: 3 };
const VERDICT: Record<string, { c: string; t: string }> = { good: { c: "var(--green)", t: "Strong" }, mid: { c: "var(--orange)", t: "Average" }, bad: { c: "var(--red)", t: "Weak" } };
const MEDIA: Record<string, string> = { IMAGE: "Image", VIDEO: "Video", CAROUSEL_ALBUM: "Carousel" };
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const costOf = (r: PostResultRow) => {
  if (!(r.result > 0)) return "—";
  if (r.type === "reach") return "$" + ((r.spend / r.result) * 1000).toFixed(2) + " /1K";
  const v = r.spend / r.result;
  return "$" + (v < 0.001 ? v.toFixed(4) : v < 0.01 ? v.toFixed(3) : v.toFixed(2));
};
const resultText = (r: PostResultRow) => `${num(r.result)} ${r.goal === "followers" ? "Visits" : TYPE_LABEL[r.type]}`;
const sortRows = (a: PostResultRow, b: PostResultRow) => (GOAL_ORDER[a.goal] ?? 9) - (GOAL_ORDER[b.goal] ?? 9) || b.spend - a.spend;

const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

export default function ReportView({ clientId }: { clientId: string }) {
  const [data, setData] = useState<PostResultsOut | null>(null);
  const [months, setMonths] = useState<MonthOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [f, setF] = useState({ month: "", branch: "", orders: "", msgOrders: "", baseline: false });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!clientId) { setData(null); setMonths([]); return; }
    let live = true;
    setLoading(true);
    Promise.all([loadPostResults(clientId, "period"), loadMonthOrders(clientId)])
      .then(([d, m]) => { if (live) { setData(d); setMonths(m); setLoading(false); } })
      .catch(() => { if (live) { setData({ ok: false, message: "Failed to load", from: "", to: "", rows: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [clientId]);

  const rows = useMemo(() => [...(data?.rows || [])].sort(sortRows), [data]);
  const good = rows.filter((r) => r.verdict === "good");
  const bad = rows.filter((r) => r.verdict === "bad");
  const unjudged = rows.filter((r) => !r.verdict).length;

  // branch orders: average before the campaign vs after
  const branches = useMemo(() => {
    const by = new Map<string, MonthOrder[]>();
    for (const m of months) by.set(m.branch, [...(by.get(m.branch) || []), m]);
    return [...by.entries()].map(([branch, list]) => {
      const b = avg(list.filter((x) => x.baseline).map((x) => x.orders));
      const a = avg(list.filter((x) => !x.baseline).map((x) => x.orders));
      return { branch, before: b, after: a, change: b && a !== null ? ((a - b) / b) * 100 : null };
    });
  }, [months]);

  const add = () => start(async () => {
    setErr("");
    const r = await saveMonthOrder(clientId, f);
    if (!r.ok) { setErr(r.message); return; }
    setMonths(await loadMonthOrders(clientId));
    setF({ ...f, orders: "", msgOrders: "" });
  });
  const del = (m: MonthOrder) => start(async () => { await deleteMonthOrder(clientId, m.month, m.branch); setMonths(await loadMonthOrders(clientId)); });

  const copyText = () => {
    const lines: string[] = [`Post\tFormat\tGoal\tSpend\tResult\tCost\tFollows\tOrders\tVerdict`];
    for (const r of rows) lines.push([r.name, MEDIA[r.mediaType] || "", GOAL[r.goal], money(r.spend), resultText(r), costOf(r), r.follows || "", r.orders ?? "", r.verdict ? VERDICT[r.verdict].t : ""].join("\t"));
    if (branches.length) {
      lines.push("", "Branch\tBefore (avg/month)\tAfter (avg/month)\tChange");
      for (const b of branches) lines.push([b.branch || "—", b.before === null ? "" : Math.round(b.before), b.after === null ? "" : Math.round(b.after), b.change === null ? "" : Math.round(b.change) + "%"].join("\t"));
    }
    lines.push("", "Best for sales: " + (good.filter((r) => r.goal === "sales").map((r) => r.name).join(", ") || "—"));
    lines.push("Best for followers: " + (good.filter((r) => r.goal === "followers").map((r) => r.name).join(", ") || "—"));
    lines.push("Stop next month: " + (bad.map((r) => r.name).join(", ") || "—"));
    try { navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  if (!clientId) return <div className="panel empty"><b>Select a client</b></div>;

  const names = (list: PostResultRow[]) => list.length === 0 ? <span className="sm">—</span> : (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{list.map((r) => <span key={r.key} className="chip mute" dir="auto">{r.name}</span>)}</div>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {data?.from && <span className="sm">{data.from} → {data.to}</span>}
        {unjudged > 0 && <span className="sm">· {unjudged} without verdict</span>}
        <button className="btn" style={{ marginInlineStart: "auto" }} onClick={copyText} disabled={rows.length === 0}>{copied ? "Copied" : "Copy report"}</button>
      </div>

      {loading && !data && <div className="panel empty"><b>Loading…</b></div>}
      {data && !data.ok && <div className="msg err" style={{ marginBottom: 12 }}>{data.message}</div>}

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3>Posts <span className="sm">· {rows.length}</span></h3>
        {rows.length === 0 ? <div className="sm">No ad spend in this period</div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="bt">
              <thead><tr><th>Post</th><th>Format</th><th>Goal</th><th>Spend</th><th>Result</th><th>Cost</th><th>Follows</th><th>Orders</th><th>Verdict</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ fontWeight: 700 }} dir="auto">{r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{r.name}</a> : r.name}{r.dark && <span className="sm"> · Offer</span>}</td>
                  <td>{MEDIA[r.mediaType] || "—"}</td><td>{GOAL[r.goal]}</td><td>{money(r.spend)}</td>
                  <td>{resultText(r)}</td><td>{costOf(r)}</td><td>{r.follows > 0 ? num(r.follows) : "—"}</td><td>{r.orders ?? "—"}</td>
                  <td>{r.verdict ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: VERDICT[r.verdict].c }} />{VERDICT[r.verdict].t}</span> : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3>Orders per month</h3>
        {branches.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 10 }}>
            <table className="bt">
              <thead><tr><th>Branch</th><th>Before (avg / month)</th><th>After (avg / month)</th><th>Change</th></tr></thead>
              <tbody>{branches.map((b) => (
                <tr key={b.branch}>
                  <td style={{ fontWeight: 700 }}>{b.branch || "—"}</td>
                  <td>{b.before === null ? "—" : num(b.before)}</td><td>{b.after === null ? "—" : num(b.after)}</td>
                  <td>{b.change === null ? "—" : (b.change > 0 ? "+" : "") + Math.round(b.change) + "%"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {months.length > 0 && (
          <div style={{ overflowX: "auto", marginBottom: 10 }}>
            <table className="bt">
              <thead><tr><th>Month</th><th>Branch</th><th>Orders</th><th>From messages</th><th></th><th></th></tr></thead>
              <tbody>{months.map((m) => (
                <tr key={m.month + "|" + m.branch}>
                  <td>{m.month}</td><td>{m.branch || "—"}</td><td>{num(m.orders)}</td><td>{m.msgOrders === null ? "—" : num(m.msgOrders)}</td>
                  <td>{m.baseline ? <span className="chip sm mute">Before</span> : ""}</td>
                  <td><button className="btn" style={{ padding: "3px 10px", fontSize: 11 }} onClick={() => del(m)} disabled={pending}>Remove</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} style={{ width: 150, padding: "6px 8px", fontSize: 13 }} />
          <input placeholder="Branch (optional)" value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} style={{ width: 150, padding: "6px 8px", fontSize: 13 }} />
          <input type="number" min={0} placeholder="Orders" value={f.orders} onChange={(e) => setF({ ...f, orders: e.target.value })} style={{ width: 90, padding: "6px 8px", fontSize: 13 }} />
          <input type="number" min={0} placeholder="From messages" value={f.msgOrders} onChange={(e) => setF({ ...f, msgOrders: e.target.value })} style={{ width: 120, padding: "6px 8px", fontSize: 13 }} />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={f.baseline} onChange={(e) => setF({ ...f, baseline: e.target.checked })} style={{ width: "auto" }} /> Before campaign
          </label>
          <button className="btn pri" onClick={add} disabled={pending}>{pending ? "…" : "Add"}</button>
        </div>
        {err && <div className="msg err" style={{ marginTop: 8 }}>{err}</div>}
      </div>

      <div className="panel" style={{ marginBottom: 12 }}>
        <h3>What we learned</h3>
        <div className="sm" style={{ margin: "6px 0" }}>Best for sales</div>
        {names(good.filter((r) => r.goal === "sales"))}
        <div className="sm" style={{ margin: "10px 0 6px" }}>Best for followers</div>
        {names(good.filter((r) => r.goal === "followers"))}
        <div className="sm" style={{ margin: "10px 0 6px" }}>Best for awareness</div>
        {names(good.filter((r) => r.goal === "awareness"))}
        <div className="sm" style={{ margin: "10px 0 6px" }}>Stop next month</div>
        {names(bad)}
      </div>
    </>
  );
}
