"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { loadPostResults, saveOrders, saveVerdict, type PostResultRow, type PostResultsOut, type RangeKey, type Verdict } from "@/app/(app)/content/results-actions";
import { TYPE_LABEL } from "@/lib/results";

const RANGES: [RangeKey, string][] = [["period", "Period"], ["7d", "7 days"], ["30d", "30 days"]];
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 2 : 0 });
const cost = (spend: number, n: number) => {
  if (!(n > 0)) return "—";
  const v = spend / n;
  return "$" + (v < 0.001 ? v.toFixed(4) : v < 0.01 ? v.toFixed(3) : v.toFixed(2));
};
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const MEDIA: Record<string, string> = { IMAGE: "Image", VIDEO: "Video", CAROUSEL_ALBUM: "Carousel" };

function PostCell({ r }: { r: PostResultRow }) {
  const sub = [r.dark ? "Offer" : "", MEDIA[r.mediaType] || "", day(r.postedAt), r.ads > 1 ? `${r.ads} ads` : ""].filter(Boolean).join(" · ");
  const inner = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 150 }}>
      <div className="pimg" style={{ width: 36, height: 36, flex: "none", borderRadius: 8, overflow: "hidden" }}>{r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <span>—</span>}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700 }} dir="auto">{r.name}</div>
        {sub && <div className="sm">{sub}</div>}
      </div>
    </div>
  );
  return r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{inner}</a> : inner;
}

function OrdersInput({ clientId, r }: { clientId: string; r: PostResultRow }) {
  const [v, setV] = useState(r.orders === null ? "" : String(r.orders));
  const [saved, setSaved] = useState(r.orders === null ? "" : String(r.orders));
  const [err, setErr] = useState(false);
  const [, start] = useTransition();
  useEffect(() => { const s = r.orders === null ? "" : String(r.orders); setV(s); setSaved(s); }, [r.orders, r.ordersKey]);
  const commit = () => {
    if (v === saved) return;
    start(async () => { const x = await saveOrders(clientId, r.ordersKey, v); setErr(!x.ok); if (x.ok) setSaved(v); });
  };
  return <input type="number" min={0} inputMode="numeric" value={v} placeholder="—" onChange={(e) => setV(e.target.value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    style={{ width: 70, padding: "5px 8px", fontSize: 13, ...(err ? { borderColor: "var(--red)" } : {}) }} />;
}

const VERDICTS: [Verdict, string, string][] = [["good", "var(--green)", "Strong"], ["mid", "var(--orange)", "Average"], ["bad", "var(--red)", "Weak"]];

function VerdictDots({ clientId, r }: { clientId: string; r: PostResultRow }) {
  const [v, setV] = useState<Verdict | null>(r.verdict);
  const [, start] = useTransition();
  useEffect(() => setV(r.verdict), [r.verdict, r.key]);
  const pick = (x: Verdict) => {
    const next = v === x ? null : x;
    setV(next);
    start(async () => { const res = await saveVerdict(clientId, r.key, next || ""); if (!res.ok) setV(v); });
  };
  return (
    <div style={{ display: "flex", gap: 7 }}>
      {VERDICTS.map(([k, color, label]) => (
        <button key={k} title={label} aria-label={label} onClick={() => pick(k)}
          style={{ width: 20, height: 20, borderRadius: "50%", cursor: "pointer", padding: 0, border: `2px solid ${color}`, background: v === k ? color : "transparent", opacity: v && v !== k ? 0.35 : 1 }} />
      ))}
    </div>
  );
}

const Follows = ({ n, always }: { n: number; always?: boolean }) => <>{n > 0 ? num(n) : always ? "0" : "—"}</>;

function Section({ title, list, children }: { title: string; list: PostResultRow[]; children: ReactNode }) {
  if (list.length === 0) return null;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <h3>{title} <span className="sm">· {list.length}</span></h3>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

export default function PostResults({ clientId }: { clientId: string }) {
  const [range, setRange] = useState<RangeKey>("period");
  const [data, setData] = useState<PostResultsOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    let live = true;
    setLoading(true);
    loadPostResults(clientId, range).then((d) => { if (live) { setData(d); setLoading(false); } }).catch(() => { if (live) { setData({ ok: false, message: "Failed to load", from: "", to: "", rows: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [clientId, range, tick]);

  if (!clientId) return <div className="panel empty"><b>Select a client</b></div>;

  const rows = data?.rows || [];
  const sales = rows.filter((r) => r.goal === "sales");
  const followers = rows.filter((r) => r.goal === "followers");
  const TYPE_ORDER: Record<string, number> = { reach: 0, engagement: 1, thruplay: 2 };
  const aware = rows.filter((r) => r.goal === "awareness").sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || b.spend - a.spend);
  const other = rows.filter((r) => r.goal === "other");

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <div className="btabs" style={{ margin: 0 }}>
          {RANGES.map(([k, l]) => <span key={k} className={`btab ${range === k ? "on" : ""}`} onClick={() => setRange(k)}>{l}</span>)}
        </div>
        {data?.from && <span className="sm">{data.from} → {data.to}</span>}
        <button className="btn" onClick={() => setTick(tick + 1)} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>

      {data && !data.ok && <div className="msg err" style={{ marginBottom: 12 }}>{data.message}</div>}
      {data?.ok && rows.length === 0 && <div className="panel empty"><b>No ad spend in this range</b></div>}
      {!data && loading && <div className="panel empty"><b>Loading…</b></div>}

      <Section title="Sales" list={sales}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Spend</th><th>Reach</th><th>Results</th><th>Cost</th><th>Follows</th><th>Orders</th><th>Verdict</th></tr></thead>
          <tbody>{sales.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td>
              <td>{num(r.result)} <span className="sm">{TYPE_LABEL[r.type]}</span></td><td>{cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} /></td>
              <td><OrdersInput clientId={clientId} r={r} /></td>
              <td><VerdictDots clientId={clientId} r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Followers" list={followers}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Spend</th><th>Reach</th><th>Visits</th><th>Cost / visit</th><th>Follows</th><th>Verdict</th></tr></thead>
          <tbody>{followers.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td>
              <td>{num(r.result)}</td><td>{cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} always /></td>
              <td><VerdictDots clientId={clientId} r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Awareness" list={aware}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Type</th><th>Spend</th><th>Reach</th><th>Results</th><th>Cost</th><th>Follows</th><th>Verdict</th></tr></thead>
          <tbody>{aware.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{TYPE_LABEL[r.type]}</td><td>{money(r.spend)}</td><td>{num(r.reach)}</td><td>{num(r.result)}</td>
              <td>{r.type === "reach" ? (r.result > 0 ? "$" + ((r.spend / r.result) * 1000).toFixed(2) + " /1K" : "—") : cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} /></td>
              <td><VerdictDots clientId={clientId} r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Other" list={other}>
        <table className="bt">
          <thead><tr><th>Ad</th><th>Spend</th><th>Reach</th><th>Follows</th><th>Verdict</th></tr></thead>
          <tbody>{other.map((r) => <tr key={r.key}><td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td><td><Follows n={r.follows} /></td><td><VerdictDots clientId={clientId} r={r} /></td></tr>)}</tbody>
        </table>
      </Section>
    </>
  );
}
