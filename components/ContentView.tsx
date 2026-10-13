"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { hidePost, listTargets, previewRun, refreshPosts, resetPost, runPost, savePost, type TargetCampaign } from "@/app/(app)/content/actions";

export type PostCard = {
  id: string; clientId: string; clientName: string; igMediaId: string; shortcode: string; permalink: string; mediaType: string;
  caption: string; username: string; thumb: string; postedAt: string | null; eligible: boolean | null; reason: string;
  status: "ready" | "running" | "done" | "skip" | "failed"; mode: "direct" | "copy" | ""; budget: string; days: string;
  campId: string; campName: string; adsetId: string; adsetName: string; error: string;
};

const TABS = [["all", "All"], ["ready", "Ready"], ["running", "Running"], ["done", "Done"], ["skip", "Skip"], ["failed", "Failed"]] as const;
const ST: Record<string, { label: string; cls: string }> = {
  ready: { label: "Ready", cls: "warn" }, running: { label: "Running", cls: "ok" }, done: { label: "Done", cls: "mute" },
  skip: { label: "Skip", cls: "mute" }, failed: { label: "Failed", cls: "bad" },
};
const TYPE: Record<string, string> = { IMAGE: "Image", VIDEO: "Video", CAROUSEL_ALBUM: "Carousel" };
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

export default function ContentView({ clients, posts }: { clients: { id: string; name: string; hasIg: boolean }[]; posts: PostCard[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("all");
  const [client, setClient] = useState("");
  const [q, setQ] = useState("");
  const [n, setN] = useState("5");
  const [sel, setSel] = useState<PostCard | null>(null);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const base = useMemo(() => posts.filter((p) => (!client || p.clientId === client) && (!q || (p.shortcode + " " + p.caption + " " + p.clientName).toLowerCase().includes(q.toLowerCase()))), [posts, client, q]);
  const count = (s: string) => (s === "all" ? base.length : base.filter((p) => p.status === s).length);
  const shown = base.filter((p) => tab === "all" || p.status === tab);
  const noIg = clients.filter((c) => !c.hasIg);

  const refresh = (count?: number) => start(async () => { const r = await refreshPosts(client || undefined, count); setMsg(r.message); router.refresh(); });

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div><div className="h1" style={{ fontSize: 20 }}>Content Manager</div></div>
        <div className="pbar">
          <select value={client} onChange={(e) => setClient(e.target.value)}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 140, padding: "7px 10px", fontSize: 13 }} />
          <button className="btn" onClick={() => refresh()} disabled={pending}>{pending ? "..." : "Refresh"}</button>
          {client && (
            <>
              <input type="number" min={1} max={50} value={n} onChange={(e) => setN(e.target.value)} style={{ width: 64, padding: "7px 10px", fontSize: 13 }} />
              <button className="btn" onClick={() => refresh(Math.min(Math.max(parseInt(n) || 1, 1), 50))} disabled={pending}>Fetch last {parseInt(n) || 1}</button>
            </>
          )}
        </div>
      </div>

      {noIg.length > 0 && <div className="fnd warn" style={{ marginBottom: 12 }}><b>No Instagram ID: {noIg.map((c) => c.name).join(", ")}</b></div>}
      {msg && <div className="fnd warn" style={{ marginBottom: 12 }}><div className="c" dir="auto">{msg}</div></div>}

      <div className="btabs">
        {TABS.map(([k, l]) => <span key={k} className={`btab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l} · {count(k)}</span>)}
      </div>

      {shown.length === 0 ? (
        <div className="panel empty"><b>{posts.length === 0 ? "No posts yet" : "No posts"}</b></div>
      ) : (
        <div className="pgridc">
          {shown.map((p) => (
            <div className="pcard" key={p.id} onClick={() => setSel(p)}>
              <div className="pimg">{p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span>—</span>}</div>
              <div className="pbody">
                <div className="ptop"><b>{p.clientName}</b><span className={`chip sm ${ST[p.status].cls}`}>{ST[p.status].label}</span></div>
                <div className="sub" style={{ margin: 0 }}>{TYPE[p.mediaType] || p.mediaType} · {p.shortcode} · {day(p.postedAt)}</div>
                <div className="pfoot">
                  <span className={`chip sm ${p.eligible === true ? "ok" : p.eligible === false ? "bad" : "mute"}`}>
                    {p.eligible === true ? "✓" : p.eligible === false ? "✗" : "?"}
                  </span>
                  {p.adsetName && <span className="sub" style={{ margin: 0 }}>{p.mode === "copy" ? "Copy" : "Direct"} · {p.adsetName}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sel && <PostModal key={sel.id} post={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); router.refresh(); }} />}
    </>
  );
}

const TARGET_CACHE = new Map<string, { t: TargetCampaign[]; at: number }>();

function PostModal({ post, onClose, onDone }: { post: PostCard; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ status: (post.status === "skip" ? "skip" : "ready") as "ready" | "skip", mode: post.mode, budget: post.budget, days: post.days, campId: post.campId, adsetId: post.adsetId });
  const cached = TARGET_CACHE.get(post.clientId);
  const [targets, setTargets] = useState<TargetCampaign[] | null>(cached && Date.now() - cached.at < 30 * 60_000 ? cached.t : null);
  const [loading, setLoading] = useState(false);
  const [tmsg, setTmsg] = useState("");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  const [pending, start] = useTransition();
  const locked = post.status === "running" || post.status === "done";

  const loadTargets = async () => {
    setLoading(true);
    try { const r = await listTargets(post.clientId); setTargets(r.campaigns); setTmsg(r.message); if (r.ok) TARGET_CACHE.set(post.clientId, { t: r.campaigns, at: Date.now() }); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!targets && !locked && f.mode) loadTargets(); /* eslint-disable-next-line */ }, [f.mode]);
  const camp = targets?.find((c) => c.id === f.campId);
  const adset = camp?.adsets.find((a) => a.id === f.adsetId);

  const save = () => start(async () => {
    const r = await savePost({
      id: post.id, status: f.status, mode: f.mode, budget: f.budget, days: f.days,
      meta_campaign_id: f.campId, meta_campaign_name: camp?.name || post.campName,
      meta_adset_id: f.adsetId, meta_adset_name: adset?.name || post.adsetName,
    });
    setMsg(r.message);
    if (r.ok) onDone();
  });
  const [plan, setPlan] = useState<string[] | null>(null);
  const canRun = post.status === "ready" && f.status === "ready" && post.eligible !== false && !!f.mode && !!f.adsetId;
  const startRun = () => start(async () => {
    setMsg("");
    const sv = await savePost({ id: post.id, status: f.status, mode: f.mode, budget: f.budget, days: f.days, meta_campaign_id: f.campId, meta_campaign_name: camp?.name || post.campName, meta_adset_id: f.adsetId, meta_adset_name: adset?.name || post.adsetName });
    if (!sv.ok) { setMsg(sv.message); return; }
    const r = await previewRun(post.id);
    if (!r.ok) { setMsg(r.message); return; }
    setPlan(r.lines);
  });
  const run = () => start(async () => {
    const r = await runPost(post.id);
    if (!r.ok) { setPlan(null); setMsg(r.message); router.refresh(); return; }
    onDone();
  });
  const del = () => { if (confirm("Hide this post?")) start(async () => { await hidePost(post.id); onDone(); }); };

  return (
    <div className="overlay" onClick={() => !pending && onClose()}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: 14 }}>
          <div className="pimg" style={{ width: 130, flex: "none", borderRadius: 10 }}>{post.thumb ? <img src={post.thumb} alt="" /> : <span>—</span>}</div>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ marginBottom: 4 }}>{post.clientName}</h2>
            <div className="sub" style={{ margin: 0 }}>@{post.username} · {TYPE[post.mediaType] || post.mediaType} · {post.shortcode}</div>
            <div style={{ margin: "6px 0" }}>
              <span className={`chip sm ${post.eligible === true ? "ok" : post.eligible === false ? "bad" : "mute"}`}>
                Check {post.eligible === true ? "✓" : post.eligible === false ? "✗" : "?"}
              </span>{" "}
              <a href={post.permalink} target="_blank" rel="noreferrer" style={{ color: "var(--blue2)", fontWeight: 600, fontSize: 13 }}>Open post</a>
            </div>
            <div className="sub" dir="ltr" style={{ margin: 0 }}>ID: {post.igMediaId}</div>
            {post.eligible === false && <div className="c" style={{ color: "var(--red)", fontSize: 12 }}>{post.reason || "Meta will not boost this post."}</div>}
          </div>
        </div>
        {post.caption && <div className="sub" dir="auto" style={{ margin: "10px 0 0", maxHeight: 54, overflow: "hidden" }}>{post.caption}</div>}
        {post.error && <div className="fnd bad" style={{ marginTop: 8 }}><div className="c" dir="auto">{post.error}</div></div>}

        <div className="grid g2" style={{ marginTop: 14 }}>
          <label className="f">Status
            <select value={f.status} disabled={locked} onChange={(e) => setF({ ...f, status: e.target.value as "ready" | "skip" })}>
              <option value="ready">Ready</option><option value="skip">Skip</option>
            </select>
          </label>
          <label className="f">Method
            <select value={f.mode} disabled={locked} onChange={(e) => setF({ ...f, mode: e.target.value as any })}>
              <option value="">— Select —</option>
              <option value="direct">Add to ad set</option>
              <option value="copy">Copy ad set for N days</option>
            </select>
          </label>
        </div>

        {f.mode && (
          <div style={{ marginTop: 10 }}>
            <div className="grid g2">
              <label className="f">Campaign
                <select value={f.campId} disabled={locked} onChange={(e) => setF({ ...f, campId: e.target.value, adsetId: "" })}>
                  <option value="">— Select —</option>
                  {f.campId && !camp && <option value={f.campId}>{post.campName || f.campId}</option>}
                  {(targets || []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "ACTIVE" ? " (paused)" : ""}</option>)}
                </select>
              </label>
              <label className="f">{f.mode === "copy" ? "Ad set to copy" : "Ad set"}
                <select value={f.adsetId} disabled={locked} onChange={(e) => setF({ ...f, adsetId: e.target.value })}>
                  <option value="">— Select —</option>
                  {f.adsetId && !adset && <option value={f.adsetId}>{post.adsetName || f.adsetId}</option>}
                  {(camp?.adsets || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            {loading && <div className="sub" style={{ marginTop: 6 }}>Loading campaigns…</div>}
            {targets && !locked && <a style={{ color: "var(--blue2)", fontSize: 12, fontWeight: 600, cursor: "pointer" }} onClick={loadTargets}>↻ Reload campaigns</a>}
            {tmsg && <div className="sub" style={{ marginTop: 6 }} dir="auto">{tmsg}</div>}
          </div>
        )}

        {f.mode === "copy" && (
          <div className="grid g2" style={{ marginTop: 10 }}>
            <label className="f">Budget ($)<input type="number" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></label>
            <label className="f">Days<input type="number" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></label>
          </div>
        )}

        {plan && (
          <div className="fnd warn" style={{ marginTop: 12 }}>
            <b>Confirm run</b>
            <div className="c">{plan.map((l, i) => <div key={i}>{l}</div>)}</div>
            <div className="acts" style={{ marginTop: 8 }}>
              <button className="btn" onClick={() => setPlan(null)} disabled={pending}>Back</button>
              <button className="btn pri" onClick={run} disabled={pending}>{pending ? "Creating…" : "Confirm & run"}</button>
            </div>
          </div>
        )}
        {msg && <div className="msg err" dir="auto">{msg}</div>}
        <div className="acts">
          {post.status === "failed" && <button className="btn" onClick={() => start(async () => { await resetPost(post.id); onDone(); })} disabled={pending}>Reset to Ready</button>}
          {canRun && !plan && <button className="btn" style={{ background: "var(--green)", color: "#fff", borderColor: "transparent" }} onClick={startRun} disabled={pending}>▶ Run</button>}
          <button className="btn" style={{ marginInlineEnd: "auto", color: "var(--red)" }} onClick={del} disabled={pending}>Delete</button>
          <button className="btn" onClick={onClose} disabled={pending}>Cancel</button>
          <button className="btn pri" onClick={save} disabled={pending || locked}>{pending ? "..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
