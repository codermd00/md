"use client";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { loadPostResults, saveOrders, saveVerdict, type PostResultRow, type PostResultsOut, type RangeKey, type Verdict } from "@/app/(app)/content/results-actions";
import { loadReview, markReviewed, type ReviewOut } from "@/app/(app)/content/review-actions";
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
      <div style={{ position: "relative", width: 36, height: 36, flex: "none" }}>
        <div className="pimg" style={{ width: 36, height: 36, borderRadius: 8, overflow: "hidden" }}>{r.thumb ? <img src={r.thumb} alt="" loading="lazy" /> : <span>—</span>}</div>
        <span title={r.active ? "Running" : "Paused"} style={{ position: "absolute", top: -3, left: -3, width: 10, height: 10, borderRadius: "50%", background: r.active ? "var(--green)" : "#8a8f9c", border: "2px solid var(--surface)" }} />
      </div>
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

function VerdictDots({ clientId, r, onSet }: { clientId: string; r: PostResultRow; onSet?: (key: string, v: Verdict | null) => void }) {
  const [v, setV] = useState<Verdict | null>(r.verdict);
  const [, start] = useTransition();
  useEffect(() => setV(r.verdict), [r.verdict, r.key]);
  const pick = (x: Verdict) => {
    const next = v === x ? null : x;
    setV(next);
    onSet?.(r.key, next);
    start(async () => { const res = await saveVerdict(clientId, r.key, next || ""); if (!res.ok) { setV(v); onSet?.(r.key, v); } });
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

function InfoButton({ r }: { r: PostResultRow }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState("");
  // several ads: only the active ones (all of them when none is active)
  const act = r.adList.filter((a) => a.active);
  const list = r.adList.length > 1 && act.length ? act : r.adList;
  const copy = (id: string) => { try { navigator.clipboard.writeText(id); setCopied(id); setTimeout(() => setCopied(""), 1200); } catch { /* ignore */ } };
  return (
    <>
      <button onClick={() => setOpen(true)} title="Ad ID" aria-label="Ad ID"
        style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px solid var(--border2)", background: "transparent", color: "var(--t2)", fontSize: 12, fontWeight: 700, fontStyle: "italic", fontFamily: "serif", cursor: "pointer", padding: 0 }}>i</button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 10 }} dir="auto">{r.name}</h2>
            {list.map((a) => (
              <div key={a.id} style={{ padding: "8px 0", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "none", background: a.active ? "var(--green)" : "#8a8f9c" }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  {a.adset && <div className="sm" dir="auto">{a.adset}</div>}
                  <div dir="ltr" style={{ fontWeight: 700, userSelect: "all", textAlign: "left" }}>{a.id}</div>
                </div>
                <button className="btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => copy(a.id)}>{copied === a.id ? "Copied" : "Copy"}</button>
              </div>
            ))}
            <div className="acts"><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}

const agoText = (iso: string | null) => {
  if (!iso) return { t: "never", late: false };
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return { t: d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`, late: d >= 7 };
};

function ReviewPanel({ clientId, rev, unjudged, onReviewed }: { clientId: string; rev: ReviewOut | null; unjudged: PostResultRow[]; onReviewed: (at: string) => void }) {
  const [pending, start] = useTransition();
  if (!rev) return null;
  const last = agoText(rev.lastReviewed);
  const nothing = rev.noAd.length === 0 && unjudged.length === 0;
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ margin: 0 }}>Weekly review</h3>
        <span className="sm" style={last.late ? { color: "var(--red)", fontWeight: 700 } : undefined}>Last: {last.t}</span>
        <button className="btn" style={{ marginInlineStart: "auto" }} disabled={pending}
          onClick={() => start(async () => { const x = await markReviewed(clientId); if (x.ok) onReviewed(x.at); })}>{pending ? "…" : "Reviewed"}</button>
      </div>
      {!rev.ok && <div className="sm" style={{ color: "var(--red)" }}>{rev.message}</div>}
      {rev.noAd.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div className="sm" style={{ marginBottom: 6 }}>No ad yet · {rev.noAd.length}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {rev.noAd.slice(0, 12).map((p) => (
              <a key={p.id} href={p.permalink} target="_blank" rel="noreferrer" title={p.shortcode} style={{ width: 40, height: 40, borderRadius: 8, overflow: "hidden", display: "block" }}>
                <div className="pimg" style={{ width: 40, height: 40 }}>{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span>—</span>}</div>
              </a>
            ))}
            {rev.noAd.length > 12 && <span className="sm" style={{ alignSelf: "center" }}>+{rev.noAd.length - 12}</span>}
          </div>
        </div>
      )}
      {unjudged.length > 0 && (
        <div>
          <div className="sm" style={{ marginBottom: 6 }}>Running, no verdict · {unjudged.length}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {unjudged.slice(0, 12).map((r) => <span key={r.key} className="chip mute" dir="auto">{r.name}</span>)}
            {unjudged.length > 12 && <span className="sm" style={{ alignSelf: "center" }}>+{unjudged.length - 12}</span>}
          </div>
        </div>
      )}
      {nothing && rev.ok && <div className="sm">Nothing pending</div>}
    </div>
  );
}

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
  const [rev, setRev] = useState<ReviewOut | null>(null);
  const [judged, setJudged] = useState<Record<string, Verdict | null>>({});
  const onSet = (key: string, v: Verdict | null) => setJudged((j) => ({ ...j, [key]: v }));

  useEffect(() => {
    if (!clientId) { setData(null); return; }
    let live = true;
    setLoading(true);
    loadPostResults(clientId, range).then((d) => { if (live) { setData(d); setLoading(false); } }).catch(() => { if (live) { setData({ ok: false, message: "Failed to load", from: "", to: "", rows: [] }); setLoading(false); } });
    return () => { live = false; };
  }, [clientId, range, tick]);

  useEffect(() => {
    setRev(null);
    if (!clientId) return;
    let live = true;
    loadReview(clientId).then((x) => { if (live) setRev(x); }).catch(() => {});
    return () => { live = false; };
  }, [clientId, tick]);
  useEffect(() => { setJudged({}); }, [data]);

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

      <ReviewPanel clientId={clientId} rev={rev} unjudged={rows.filter((r) => r.active && !(r.key in judged ? judged[r.key] : r.verdict))} onReviewed={(at) => setRev(rev && { ...rev, lastReviewed: at })} />

      {data && !data.ok && <div className="msg err" style={{ marginBottom: 12 }}>{data.message}</div>}
      {data?.ok && rows.length === 0 && <div className="panel empty"><b>No ad spend in this range</b></div>}
      {!data && loading && <div className="panel empty"><b>Loading…</b></div>}

      <Section title="Sales" list={sales}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Spend</th><th>Reach</th><th>Results</th><th>Cost</th><th>Follows</th><th>Orders</th><th>Verdict</th><th></th></tr></thead>
          <tbody>{sales.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td>
              <td>{num(r.result)} <span className="sm">{TYPE_LABEL[r.type]}</span></td><td>{cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} /></td>
              <td><OrdersInput clientId={clientId} r={r} /></td>
              <td><VerdictDots clientId={clientId} r={r} onSet={onSet} /></td>
              <td><InfoButton r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Followers" list={followers}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Spend</th><th>Reach</th><th>Visits</th><th>Cost / visit</th><th>Follows</th><th>Verdict</th><th></th></tr></thead>
          <tbody>{followers.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td>
              <td>{num(r.result)}</td><td>{cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} always /></td>
              <td><VerdictDots clientId={clientId} r={r} onSet={onSet} /></td>
              <td><InfoButton r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Awareness" list={aware}>
        <table className="bt">
          <thead><tr><th>Post</th><th>Type</th><th>Spend</th><th>Reach</th><th>Results</th><th>Cost</th><th>Follows</th><th>Verdict</th><th></th></tr></thead>
          <tbody>{aware.map((r) => (
            <tr key={r.key}>
              <td><PostCell r={r} /></td><td>{TYPE_LABEL[r.type]}</td><td>{money(r.spend)}</td><td>{num(r.reach)}</td><td>{num(r.result)}</td>
              <td>{r.type === "reach" ? (r.result > 0 ? "$" + ((r.spend / r.result) * 1000).toFixed(2) + " /1K" : "—") : cost(r.spend, r.result)}</td>
              <td><Follows n={r.follows} /></td>
              <td><VerdictDots clientId={clientId} r={r} onSet={onSet} /></td>
              <td><InfoButton r={r} /></td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      <Section title="Other" list={other}>
        <table className="bt">
          <thead><tr><th>Ad</th><th>Spend</th><th>Reach</th><th>Follows</th><th>Verdict</th><th></th></tr></thead>
          <tbody>{other.map((r) => <tr key={r.key}><td><PostCell r={r} /></td><td>{money(r.spend)}</td><td>{num(r.reach)}</td><td><Follows n={r.follows} /></td><td><VerdictDots clientId={clientId} r={r} onSet={onSet} /></td><td><InfoButton r={r} /></td></tr>)}</tbody>
        </table>
      </Section>
    </>
  );
}
