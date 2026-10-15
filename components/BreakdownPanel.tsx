"use client";
import { useMemo, useState } from "react";
import type { AdSetDTO, BreakdownRow, CampaignDTO } from "./PerformanceView";
import { TYPE_LABEL } from "@/lib/results";

const DIMS = [
  { id: "results", label: "Results" }, { id: "region", label: "Region" }, { id: "age", label: "Age" }, { id: "gender", label: "Gender" },
  { id: "platform", label: "Platform" }, { id: "placement", label: "Placement" },
] as const;
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const num = (n: number) => Math.round(n).toLocaleString("en-US");
const MIN_SPEND = 3, MIN_RESULTS = 5;

export default function BreakdownPanel({ campaigns, adsets, breakdown, initial }: {
  campaigns: CampaignDTO[]; adsets: AdSetDTO[]; breakdown: BreakdownRow[]; initial: string;
}) {
  const [ent, setEnt] = useState(initial);
  const [dim, setDim] = useState<(typeof DIMS)[number]["id"]>("results");

  const info = useMemo(() => {
    const c = campaigns.find((x) => x.id === ent);
    if (c) return { type: c.type, spend: c.spend, result: c.result, level: "campaign" as const };
    const a = adsets.find((x) => x.id === ent);
    const parent = a && campaigns.find((x) => x.id === a.campaignId);
    return a && parent ? { type: parent.type, spend: a.spend, result: a.results, level: "adset" as const } : null;
  }, [ent, campaigns, adsets]);

  const rows = useMemo(() => {
    if (!info) return [];
    const isReach = info.type === "reach";
    const avg = info.result > 0 ? (isReach ? (info.spend / info.result) * 1000 : info.spend / info.result) : null;
    const seen = new Map<string, BreakdownRow>();
    for (const b of breakdown) {
      if (b.entityId !== ent || b.dimension !== dim || b.spend <= 0) continue;
      const prev = seen.get(b.key);
      if (!prev || (b.dateTo || "") > (prev.dateTo || "")) seen.set(b.key, b);
    }
    const list = [...seen.values()]
      .map((b) => {
        const cpr = b.results > 0 ? (isReach ? (b.spend / b.results) * 1000 : b.spend / b.results) : null;
        const small = b.spend < MIN_SPEND || b.results < MIN_RESULTS;
        return { ...b, cpr, small };
      });
    const totalSpend = list.reduce((s, r) => s + r.spend, 0);
    const totalRes = isReach ? 0 : list.reduce((s, r) => s + r.results, 0); // الوصول لا يُجمع عبر الشرائح
    const solid = list.filter((r) => !r.small && r.cpr !== null);
    const best = solid.length >= 2 ? solid.reduce((a, b) => (b.cpr! < a.cpr! ? b : a)) : null;
    const worst = solid.length >= 2 ? solid.reduce((a, b) => (b.cpr! > a.cpr! ? b : a)) : null;
    list.sort((a, b) => b.spend - a.spend);
    if (!list.some((r) => r.results > 0)) list.forEach((r) => { r.cpr = null; r.small = false; });
    return list.map((r) => ({
      ...r, spendShare: totalSpend ? (r.spend / totalSpend) * 100 : 0,
      resShare: !isReach && totalRes ? (r.results / totalRes) * 100 : null,
      vs: avg && r.cpr !== null ? (r.cpr / avg - 1) * 100 : null,
      isBest: !!best && r === (best as any), isWorst: !!worst && r === (worst as any),
    })).map((r) => ({ ...r, isBest: !!best && r.key === best.key, isWorst: !!worst && r.key === worst.key && worst.key !== best?.key }));
  }, [breakdown, ent, dim, info]);

  // Results tab: the selected campaign (with its ad sets) or the selected ad set
  const summary = useMemo(() => {
    const leadsOf = (id: string) => {
      const rs = breakdown.filter((b) => b.entityId === id && b.dimension === "platform");
      return rs.reduce((s, r) => s + r.leads, 0);
    };
    const mk = (name: string, type: string, x: { spend: number; results: number; impressions: number; clicks: number; reach: number; follows: number }, id: string, sub = false) => {
      const isReach = type === "reach";
      return {
        id, name, sub, spend: x.spend, results: x.results, reach: x.reach, leads: leadsOf(id), follows: x.follows,
        cpr: x.results > 0 ? (isReach ? (x.spend / x.results) * 1000 : x.spend / x.results) : null,
        cpm: x.impressions > 0 ? (x.spend / x.impressions) * 1000 : null,
        ctr: x.impressions > 0 ? (x.clicks / x.impressions) * 100 : null,
      };
    };
    const c = campaigns.find((k) => k.id === ent);
    if (c) {
      return [mk(c.name, c.type, { spend: c.spend, results: c.result, impressions: c.impressions, clicks: c.clicks, reach: c.reach, follows: c.follows }, c.id),
        ...adsets.filter((a) => a.campaignId === c.id && a.spend > 0).map((a) => mk(a.name, c.type, { spend: a.spend, results: a.results, impressions: a.impressions, clicks: a.clicks, reach: a.reach, follows: a.follows }, a.id, true))];
    }
    const a = adsets.find((x) => x.id === ent);
    const parent = a && campaigns.find((k) => k.id === a.campaignId);
    return a && parent ? [mk(a.name, parent.type, { spend: a.spend, results: a.results, impressions: a.impressions, clicks: a.clicks, reach: a.reach, follows: a.follows }, a.id)] : [];
  }, [breakdown, ent, campaigns, adsets]);

  const cprFmt = (v: number | null) => v === null ? "—" : "$" + (v < 0.01 ? v.toFixed(3) : v.toFixed(2)) + (info?.type === "reach" ? " /1K" : "");
  const noResults = rows.length > 0 && !rows.some((r) => r.results > 0);
  const best = rows.find((r) => r.isBest), worst = rows.find((r) => r.isWorst);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div>
          <h3>Results Breakdown</h3>
        </div>
        <div className="pbar">
          <select value={ent} onChange={(e) => setEnt(e.target.value)}>
            {campaigns.map((c) => (
              [<option key={c.id} value={c.id}>{c.name}</option>,
               ...adsets.filter((a) => a.campaignId === c.id && a.spend > 0).map((a) => <option key={a.id} value={a.id}>&nbsp;&nbsp;↳ {a.name}</option>)]
            ))}
          </select>
        </div>
      </div>
      <div className="btabs">
        {DIMS.map((d) => <span key={d.id} className={`btab ${dim === d.id ? "on" : ""}`} onClick={() => setDim(d.id)}>{d.label}</span>)}
      </div>
      {dim === "results" ? (
        summary.length === 0 ? <div className="empty" style={{ padding: 24 }}><b>No data yet</b></div> : (
          <div style={{ overflowX: "auto" }}>
            <table className="bt" key="results">
              <thead><tr><th>Name</th><th>Spend</th><th>Results</th><th>CPR</th><th>Reach</th><th>CPM</th><th>CTR</th><th>Leads</th><th>Follows</th></tr></thead>
              <tbody>
                {summary.map((r) => (
                  <tr key={r.id}>
                    <td style={r.sub ? { paddingLeft: 22, color: "var(--t2)" } : { fontWeight: 700 }}>{r.sub ? "↳ " : ""}{r.name}</td>
                    <td>{money(r.spend)}</td><td>{num(r.results)}</td>
                    <td>{r.cpr === null ? "—" : "$" + (r.cpr < 0.01 ? r.cpr.toFixed(3) : r.cpr.toFixed(2)) + (info?.type === "reach" ? " /1K" : "")}</td>
                    <td>{num(r.reach)}</td><td>{r.cpm === null ? "—" : "$" + r.cpm.toFixed(2)}</td><td>{r.ctr === null ? "—" : r.ctr.toFixed(2) + "%"}</td><td>{num(r.leads)}</td><td>{num(r.follows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows.length === 0 ? (
        <div className="empty" style={{ padding: 24 }}><b>No data yet</b>Run Sync now from Clients.</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="bt" key={ent + "|" + dim}>
            <thead><tr>
              <th>{DIMS.find((d) => d.id === dim)!.label}</th><th>Spend</th><th>% Spend</th><th>Results</th><th>Meta leads</th><th>Follows</th>
              {info?.type !== "reach" && <th>% Results</th>}<th>CPR</th><th>vs Avg</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={dim + "|" + r.key} className={r.isBest ? "best" : r.isWorst ? "worst" : ""}>
                  <td>{r.key}{r.small && <span className="sm"> · small sample</span>}</td>
                  <td>{money(r.spend)}</td><td>{Math.round(r.spendShare)}%</td><td>{num(r.results)}</td><td>{num(r.leads)}</td><td>{num(r.follows)}</td>
                  {info?.type !== "reach" && <td>{r.resShare !== null ? Math.round(r.resShare) + "%" : "—"}</td>}
                  <td>{cprFmt(r.cpr)}</td>
                  <td>{r.vs === null || r.small ? "—" : <b style={{ color: r.vs <= 0 ? "var(--green)" : "var(--red)" }}>{r.vs <= 0 ? "▼" : "▲"} {Math.abs(Math.round(r.vs))}%</b>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rec">
            {noResults
              ? "No results returned for this breakdown (spend only)."
              : best && worst
              ? <>Best: <b>{best.key}</b> ({cprFmt(best.cpr)}) · Worst: <b>{worst.key}</b> ({cprFmt(worst.cpr)}, {Math.round(worst.spendShare)}% of spend)</>
              : "Not enough data to compare (needs spend ≥ $3 and results ≥ 5)."}
            
          </div>
        </div>
      )}
    </div>
  );
}
