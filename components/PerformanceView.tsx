"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LineChart, { type Series } from "./LineChart";
import BreakdownPanel from "./BreakdownPanel";
import AiPanel from "./AiPanel";
import type { Finding } from "@/lib/diagnose";
import { deletePeriod, saveGoal } from "@/app/(app)/performance/actions";
import { syncNow } from "@/app/(app)/clients/actions";
import { TYPE_LABEL, type CampaignType } from "@/lib/results";
import type { Progress } from "@/lib/progress";

export type CampaignDTO = {
  id: string; name: string; type: CampaignType; status: string;
  spend: number; result: number; cpr: number | null; prevCpr: number | null;
  goalTarget: number | null; goalBudget: number | null; progress: Progress;
  prevSpend: number; prevResult: number; findings: Finding[];
  impressions: number; clicks: number; reach: number; follows: number;
};
export type AdSetDTO = { id: string; campaignId: string; name: string; effectiveStatus: string; spend: number; results: number; impressions: number; clicks: number; reach: number; follows: number };
export type BreakdownRow = {
  level: "campaign" | "adset"; entityId: string; dimension: string; key: string;
  spend: number; impressions: number; clicks: number; reach: number; results: number; leads: number; follows: number; dateTo?: string;
};
export type DailyRow = { campaignId: string; day: string; spend: number; results: number };
type ClientInfo = { id: string; name: string; periodStart: string | null; periodEnd: string | null; budget: number };

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const cprText = (type: CampaignType, v: number | null) =>
  v === null ? "—" : "$" + (v < 0.01 ? v.toFixed(3) : v.toFixed(2)) + (type === "reach" ? " /1K" : "");

const STATUS: Record<string, { label: string; cls: string }> = {
  achieved: { label: "Achieved", cls: "ok" }, on_track: { label: "On track", cls: "ok" },
  late: { label: "Late", cls: "bad" }, missed: { label: "Missed", cls: "bad" }, no_target: { label: "No target", cls: "mute" },
};
const TYPES: CampaignType[] = ["messages", "reach", "visit", "engagement"];

export default function PerformanceView(props: {
  clients: { id: string; name: string }[]; client: ClientInfo | null;
  campaigns: CampaignDTO[]; adsets: AdSetDTO[]; breakdown: BreakdownRow[]; daily: DailyRow[]; today: string; threshold: number;
  periods?: { from: string; to: string }[]; periodSel?: string;
}) {
  const { clients, client, campaigns, adsets, breakdown, daily, threshold, today } = props;
  const periods = props.periods || [], periodSel = props.periodSel || "";
  const router = useRouter();
  const [sel, setSel] = useState(campaigns.find((c) => c.type === "messages")?.id || "all");
  const [edit, setEdit] = useState<CampaignDTO | null>(null);
  const [form, setForm] = useState({ budget: "", target: "" });
  const [msg, setMsg] = useState<string>("");
  const [pending, start] = useTransition();

  const [syncing, setSyncing] = useState(false);
  const [dayPick, setDayPick] = useState<{ day: string; n: number } | null>(null);
  const picked = sel === "all" ? null : campaigns.find((c) => c.id === sel) || null;

  const byType = useMemo(() => {
    return TYPES.map((t) => {
      const cs = campaigns.filter((c) => c.type === t);
      if (!cs.length) return null;
      const result = cs.reduce((s, c) => s + c.result, 0);
      const spend = cs.reduce((s, c) => s + c.spend, 0);
      const target = cs.reduce((s, c) => s + (c.progress.target || 0), 0);
      const mul = t === "reach" ? 1000 : 1;
      const cpr = result > 0 ? (spend / result) * mul : null;
      // السابق: مرجّح بالصرف (مجموع صرف ÷ مجموع نتائج) داخل النوع نفسه
      const pSpend = cs.reduce((s, c) => s + c.prevSpend, 0);
      const pRes = cs.reduce((s, c) => s + c.prevResult, 0);
      const prevCpr = pRes > 0 ? (pSpend / pRes) * mul : null;
      return { t, result, target, cpr, prevCpr };
    }).filter(Boolean) as { t: CampaignType; result: number; target: number; cpr: number | null; prevCpr: number | null }[];
  }, [campaigns]);

  // Meta leads: sum of the platform breakdown (latest row per campaign + platform)
  const leadStats = useMemo(() => {
    const latest = new Map<string, BreakdownRow>();
    for (const b of breakdown) {
      if (b.level !== "campaign" || b.dimension !== "platform") continue;
      if (picked && b.entityId !== picked.id) continue;
      const k = b.entityId + "|" + b.key, q = latest.get(k);
      if (!q || (b.dateTo || "") > (q.dateTo || "")) latest.set(k, b);
    }
    const leads = [...latest.values()].reduce((x, r) => x + r.leads, 0);
    const spend = picked ? picked.spend : campaigns.reduce((x, c) => x + c.spend, 0);
    return { leads, cpl: leads > 0 ? spend / leads : null };
  }, [breakdown, picked, campaigns]);

  const totalSpend = campaigns.reduce((s, c) => s + c.spend, 0);
  const allocated = campaigns.reduce((s, c) => s + (c.goalBudget || 0), 0);

  const chart = useMemo(() => {
    const rows = picked ? daily.filter((d) => d.campaignId === picked.id) : daily;
    const days = [...new Set(rows.map((d) => d.day))].sort();
    const labels = days;
    if (picked) {
      const spendBy = new Map<string, number>(), resBy = new Map<string, number>();
      rows.forEach((d) => { spendBy.set(d.day, d.spend); resBy.set(d.day, d.results); });
      const series: Series[] = [
        { name: `Results (${TYPE_LABEL[picked.type]})`, color: "#7aa2e3", fill: true, axis: "left", values: days.map((d) => resBy.get(d) ?? 0) },
        {
          name: picked.type === "reach" ? "CPR /1K" : "CPR", color: "#f5c261", axis: "left", fmt: (v: number) => "$" + v.toFixed(2),
          values: days.map((d) => {
            const r = resBy.get(d) || 0, s = spendBy.get(d) || 0;
            return r > 0 ? (picked.type === "reach" ? (s / r) * 1000 : s / r) : null;
          }),
        },
      ];
      return { labels, series };
    }
    const spendBy = new Map<string, number>();
    rows.forEach((d) => spendBy.set(d.day, (spendBy.get(d.day) || 0) + d.spend));
    return { labels, series: [{ name: "Spend", color: "#7aa2e3", fill: true, axis: "left", fmt: (v: number) => "$" + v.toFixed(2), values: days.map((d) => spendBy.get(d) ?? 0) } as Series] };
  }, [daily, picked]);

  function openEdit(c: CampaignDTO) {
    setEdit(c); setMsg("");
    setForm({ budget: c.goalBudget != null ? String(c.goalBudget) : "", target: c.goalTarget != null ? String(c.goalTarget) : "" });
  }
  function submit() {
    if (!edit || !client?.periodStart) return;
    start(async () => {
      const r = await saveGoal({ campaignId: edit.id, periodStart: client.periodStart!, budget: form.budget, target: form.target });
      setMsg(r.message);
      if (r.ok) { setEdit(null); router.refresh(); }
    });
  }

  if (!client) {
    return (
      <>
        <div className="topbar"><div><div className="h1">Performance</div></div></div>
        <div className="card empty"><b>No clients yet</b>Add a client from Clients first.</div>
      </>
    );
  }

  const chip = (st: string, sm = false) => <span className={`chip ${STATUS[st].cls}${sm ? " sm" : ""}`}>{STATUS[st].label}</span>;
  const delta = (cur: number | null, prev: number | null) =>
    cur !== null && prev ? (
      <b style={{ color: cur <= prev ? "var(--green)" : "var(--red)" }}>
        {cur <= prev ? "▼" : "▲"} {Math.abs(Math.round(((cur - prev) / prev) * 100))}%
      </b>
    ) : null;

  return (
    <>
      <div className="topbar" style={{ marginBottom: 14 }}>
        <div>
          <div className="h1" style={{ fontSize: 20 }}>Performance</div>
          <div className="sub">{client.periodStart || "—"} → {client.periodEnd || "—"}{periodSel ? " · Archive" : ` · ${money(client.budget)}`}</div>
        </div>
        <div className="pbar">
          <select value={client.id} onChange={(e) => router.push(`/performance?client=${e.target.value}`)}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {periods.length > 0 && (
            <select value={periodSel} onChange={(e) => router.push(`/performance?client=${client.id}${e.target.value ? `&period=${e.target.value}` : ""}`)}>
              <option value="">Current period</option>
              {periods.map((p) => <option key={p.from} value={p.from}>{p.from} → {p.to}</option>)}
            </select>
          )}
          {periodSel && (
            <button className="btn" style={{ color: "var(--red)" }} disabled={syncing} onClick={async () => {
              if (!confirm(`Delete archived period ${periodSel}?`)) return;
              setSyncing(true);
              const r = await deletePeriod(client.id, periodSel);
              setSyncing(false);
              if (r.ok) router.push(`/performance?client=${client.id}`); else alert(r.message);
            }}>Delete period</button>
          )}
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            <option value="all">All campaigns</option>
            {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} · {TYPE_LABEL[c.type]}</option>)}
          </select>
          <button className="btn" disabled={!picked} onClick={() => picked && openEdit(picked)} title={picked ? "" : "Select a campaign first"}>Edit goal</button>
          {!periodSel && <button className="btn" disabled={syncing} onClick={async () => { setSyncing(true); try { await syncNow(client.id); } finally { setSyncing(false); router.refresh(); } }}>{syncing ? "Syncing…" : "Sync"}</button>}
        </div>
      </div>

      {!client.periodStart && <div className="panel" style={{ marginBottom: 12, color: "var(--orange)" }}>No period set for this client — edit it in Clients.</div>}
      {campaigns.length === 0 ? (
        <div className="panel empty"><b>No campaigns with spend in this period</b>Check the dates or run Sync now in Clients.</div>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi">
              <div className="l">Results vs Target</div>
              {picked ? (
                <>
                  <div className="v">{num(picked.result)}{picked.progress.target ? <small> / {num(picked.progress.target)}</small> : null}</div>
                  <div className="bar"><i style={{ width: `${Math.min(100, picked.progress.pct || 0)}%` }} /></div>
                  <div className="n">{chip(picked.progress.status, true)} {picked.progress.pct !== null ? `${Math.round(picked.progress.pct)}%` : ""}</div>
                </>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {byType.map((x) => (
                    <div className="ln" key={x.t}><span>{TYPE_LABEL[x.t]}</span><b>{num(x.result)}{x.target ? ` / ${num(x.target)}` : ""}</b></div>
                  ))}
                </div>
              )}
            </div>

            <div className="kpi">
              <div className="l">CPR vs last period</div>
              {picked ? (
                <>
                  <div className="v">{cprText(picked.type, picked.cpr)}</div>
                  <div className="n">Prev {cprText(picked.type, picked.prevCpr)} {delta(picked.cpr, picked.prevCpr)}</div>
                </>
              ) : (
                <div style={{ marginTop: 6 }}>
                  {byType.map((x) => (
                    <div className="ln" key={x.t}><span>{TYPE_LABEL[x.t]}</span><b>{cprText(x.t, x.cpr)} {delta(x.cpr, x.prevCpr)}</b></div>
                  ))}
                </div>
              )}
            </div>

            {(() => {
              const spend = picked ? picked.spend : totalSpend;
              const budget = picked ? picked.goalBudget : client.budget;
              const over = budget ? spend > budget : false;
              return (
                <div className="kpi">
                  <div className="l">Spend vs Budget</div>
                  <div className="v" style={over ? { color: "var(--red)" } : undefined}>{money(spend)}{budget ? <small> / {money(budget)}</small> : null}</div>
                  <div className={`bar ${over ? "over" : ""}`}><i style={{ width: `${budget ? Math.min(100, (spend / budget) * 100) : 0}%` }} /></div>
                  <div className="n">{budget ? `Left ${money(Math.max(0, budget - spend))}` : "Set budget (Edit goal)"}</div>
                </div>
              );
            })()}

            <div className="kpi">
              <div className="l">Leads</div>
              <div className="v">{num(leadStats.leads)}</div>
              <div className="n">{leadStats.cpl !== null ? `${money(leadStats.cpl)} per lead` : ""}</div>
            </div>

            <div className="kpi">
              <div className="l">{picked ? "Forecast (end of period)" : "Budget allocated"}</div>
              {picked ? (
                <>
                  <div className="v">{picked.progress.forecast !== null ? num(picked.progress.forecast) : "—"}</div>
                  <div className="n">
                    {picked.progress.target && picked.progress.forecast !== null
                      ? `${Math.round((picked.progress.forecast / picked.progress.target) * 100)}% of target`
                      : ""}
                  </div>
                </>
              ) : (
                <>
                  <div className="v">{money(allocated)}<small> / {money(client.budget)}</small></div>
                  <div className="n">{allocated > client.budget ? "Over client budget" : ""}</div>
                </>
              )}
            </div>
          </div>

          <div className="pgrid">
            <div className="panel">
              <h3>{picked ? `${picked.name}` : "Spend — all campaigns"}</h3>
              
              <LineChart onPick={(day) => setDayPick((d) => ({ day, n: (d?.n || 0) + 1 }))} labels={chart.labels} series={chart.series} height={230} split={false} partialLast={chart.labels[chart.labels.length - 1] === today} />
              

              <div style={{ marginTop: 10 }}>
                <h3>Diagnosis</h3>
                {picked ? (
                  <>
                    
                    <div className="diag">
                      {picked.findings.map((f, i) => (
                        <div className={`fnd ${f.level}`} key={i}>
                          <b>{f.title}</b>
                          {f.cause && <div className="c">{f.cause}</div>}
                          {f.action && <div className="a">← {f.action}</div>}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    
                    {(() => {
                      const att = campaigns.filter((c) => c.findings.some((f) => f.level !== "ok"));
                      if (!att.length) return <div className="fnd ok"><b>No issues found</b></div>;
                      return att.map((c) => {
                        const top = c.findings[0];
                        return (
                          <div className="dsum" key={c.id} onClick={() => setSel(c.id)}>
                            <span><b>{c.name}</b> · {top.title}</span>
                            <span className={`chip sm ${top.level}`}>{c.findings.filter((f) => f.level !== "ok").length}</span>
                          </div>
                        );
                      });
                    })()}
                  </>
                )}
              </div>
            </div>

            <div className="panel">
              <h3>Progress</h3>
              
              <div className="plist">
                {campaigns.map((c) => {
                  const p = c.progress;
                  const bad = p.status === "late" || p.status === "missed";
                  return (
                    <div className={`prow ${c.id === sel ? "on" : ""}`} key={c.id} onClick={() => setSel(c.id === sel ? "all" : c.id)}>
                      <div className="top">
                        <div className="nm" title={c.name}>{c.name}<span className="tp">{TYPE_LABEL[c.type]}</span></div>
                        {chip(p.status, true)}
                      </div>
                      <div className="bar"><i style={{ width: `${Math.min(100, p.pct || 0)}%`, background: bad ? "var(--red)" : undefined }} /></div>
                      <div className="meta">
                        <span><b>{num(c.result)}</b>{p.target ? ` / ${num(p.target)}` : ""}{p.pct !== null ? ` · ${Math.round(p.pct)}%` : ""}</span>
                        <span>Balance <b>{p.balance !== null ? money(p.balance) : "—"}</b></span>
                        <span style={{ marginLeft: "auto" }}>
                          <a style={{ color: "var(--blue2)", fontWeight: 600 }} onClick={(e) => { e.stopPropagation(); openEdit(c); }}>Edit</a>
                        </span>
                      </div>
                      {!p.target && <div className="src">No target set</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <BreakdownPanel dayPick={dayPick} key={sel + (client.periodStart || "")} range={client.periodStart ? { min: client.periodStart, max: client.periodEnd && client.periodEnd < today ? client.periodEnd : today } : undefined} campaigns={campaigns} adsets={adsets} breakdown={breakdown} initial={picked ? picked.id : campaigns[0].id} />
          <AiPanel key={client.id + (client.periodStart || "")} clientId={client.id} periodStart={client.periodStart || undefined} />
        </>
      )}

      {edit && (
        <div className="overlay" onClick={() => !pending && setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{edit.name}</h2>
            <div className="sub" style={{ marginBottom: 14 }}>{TYPE_LABEL[edit.type]}</div>
            <div className="grid g2">
              <label className="f">Campaign budget ($)<input type="number" value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} /></label>
              <label className="f">
                {`Target (${TYPE_LABEL[edit.type]})`}
                <input type="number" value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })} />
              </label>
            </div>
            {msg && <div className="msg err">{msg}</div>}
            <div className="acts">
              <button className="btn" onClick={() => setEdit(null)} disabled={pending}>Cancel</button>
              <button className="btn pri" onClick={submit} disabled={pending}>{pending ? "..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
