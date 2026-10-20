import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { daysLeft, todayStr } from "@/lib/dates";
import { TYPE_LABEL, type CampaignType } from "@/lib/results";
import { EditClientButton, EditGoalButton } from "@/components/ClientPageEdit";

export const dynamic = "force-dynamic";
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const ago = (iso: string | null) => {
  if (!iso) return "Never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "Now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const limitText = (t: string, v: number) => "$" + (v < 0.01 ? v.toFixed(3) : v.toFixed(2)) + (t === "reach" ? " /1K" : "");

export default async function ClientPage({ params }: { params: { id: string } }) {
  const sb = createServerSupabase();
  const { data: c } = await sb.from("clients").select("*").eq("id", params.id).single();
  if (!c) notFound();

  const { data: camps } = await sb.from("campaigns").select("id,name,type,effective_status").eq("client_id", c.id);
  const ids = (camps || []).map((k: any) => k.id);
  const [{ data: ranges }, { data: goals }] = await Promise.all([
    ids.length ? sb.from("insights_range").select("entity_id,date_from,spend,synced_at").eq("level", "campaign").in("entity_id", ids).order("synced_at", { ascending: false }) : Promise.resolve({ data: [] as any[] }),
    c.period_start && ids.length ? sb.from("campaign_goals").select("campaign_id,budget,target").eq("period_start", c.period_start).in("campaign_id", ids) : Promise.resolve({ data: [] as any[] }),
  ]);

  // Budget split per campaign: spent, still reserved for it, and what is committed in total
  const rows = (camps || []).map((k: any) => {
    const r = (ranges || []).find((x: any) => x.entity_id === k.id && (!c.period_start || x.date_from === c.period_start));
    const spend = r ? Number(r.spend) : 0;
    const g = (goals || []).find((x: any) => x.campaign_id === k.id);
    const budget = g?.budget != null ? Number(g.budget) : null;
    const target = g?.target != null ? Number(g.target) : null;
    return { k, spend, budget, target, balance: budget !== null ? budget - spend : null, committed: Math.max(budget || 0, spend) };
  }).filter((x: any) => x.spend > 0 || (x.budget || 0) > 0 || x.k.effective_status === "ACTIVE").sort((a: any, b: any) => b.committed - a.committed);

  const total = Number(c.budget) || 0;
  const spent = rows.reduce((s: number, x: any) => s + x.spend, 0);
  const reserved = rows.reduce((s: number, x: any) => s + Math.max(0, (x.budget || 0) - x.spend), 0);
  const committed = rows.reduce((s: number, x: any) => s + x.committed, 0);
  const free = total - committed;            // not given to any campaign yet
  const left = daysLeft(c.period_end, todayStr());
  const pct = (n: number) => (total > 0 ? Math.min(100, Math.max(0, (n / total) * 100)) : 0);
  const limits = (c.alert_limits || {}) as Record<string, number>;
  const limitRows = Object.entries(limits).filter(([, v]) => Number(v) > 0);

  const lim = (t: string) => (limits[t] != null ? String(limits[t]) : "");
  const editInput = {
    id: c.id, name: c.name, ig_username: c.ig_username || "", ad_account_id: c.ad_account_id || "",
    period_start: c.period_start || "", period_end: c.period_end || "", budget: String(c.budget || ""),
    business_type: c.business_type || "", city: c.city || "", page_id: c.page_id || "", ig_user_id: c.ig_user_id || "", run_posts: c.run_posts !== false,
    alert_messages: lim("messages"), alert_engagement: lim("engagement"), alert_reach: lim("reach"), alert_visit: lim("visit"), alert_leads: lim("leads"), alert_thruplay: lim("thruplay"),
  };

  const info: [string, string][] = [
    ["Ad account", c.ad_account_id ? `act_${c.ad_account_id}` : "—"],
    ["Instagram", c.ig_username ? `@${c.ig_username}` : "—"],
    ["Business", c.business_type || "—"],
    ["City", c.city || "—"],
    ["Currency", c.currency || "—"],
    ["Period", `${c.period_start || "—"} → ${c.period_end || "—"}`],
    ["Days left", left === null ? "—" : String(left)],
    ["Posts fetching", c.run_posts ? "On" : "Off"],
    ["Last sync", ago(c.synced_at)],
  ];

  return (
    <>
      <Link href="/clients" className="back">← Clients</Link>
      <div className="topbar">
        <div>
          <div className="h1">{c.name}</div>
          <div className="sub">{c.ig_username ? `@${c.ig_username}` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <EditClientButton initial={editInput} />
          <Link className="btn" href={`/performance?client=${c.id}`}>Performance</Link>
          <span className={`chip ${c.account_status === "active" ? "ok" : c.account_status ? "bad" : "warn"}`}>{c.account_status || "Not synced"}</span>
        </div>
      </div>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="card"><div className="sub">Budget</div><div className="h1">{money(total)}</div></div>
        <div className="card"><div className="sub">Spent</div><div className="h1">{money(spent)}</div></div>
        <div className="card"><div className="sub">Remaining</div><div className="h1">{money(Math.max(0, total - spent))}</div></div>
        <div className="card"><div className="sub">Available to allocate</div><div className="h1" style={free < 0 ? { color: "var(--red)" } : undefined}>{money(free)}</div></div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Budget split</h3>
        <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden", background: "var(--surface2)" }}>
          <i style={{ width: `${pct(spent)}%`, background: "var(--blue2)" }} />
          <i style={{ width: `${pct(reserved)}%`, background: "var(--orange)" }} />
        </div>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 12.5 }}>
          <span><i className="wdotl" style={{ background: "var(--blue2)" }} />Spent {money(spent)}</span>
          <span><i className="wdotl" style={{ background: "var(--orange)" }} />Reserved for campaigns {money(reserved)}</span>
          <span><i className="wdotl" style={{ background: "var(--surface2)", border: "1px solid var(--border)" }} />Free {money(Math.max(0, free))}</span>
        </div>
        {free < 0 && <div className="sub" style={{ marginTop: 8, color: "var(--red)" }}>Campaign budgets exceed the client budget by {money(-free)}</div>}
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <h3>Budget by campaign</h3>
        {rows.length === 0 ? (
          <div className="empty"><b>No campaign budgets yet</b></div>
        ) : (
          <div style={{ overflowX: "auto" }}><table className="tbl tcards">
            <thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Budget</th><th>Spent</th><th>Balance</th><th>Share</th><th></th></tr></thead>
            <tbody>
              {rows.map(({ k, spend, budget, target, balance, committed }: any) => (
                <tr key={k.id}>
                  <td><b>{k.name}</b></td>
                  <td><span className="chip mute">{TYPE_LABEL[k.type as CampaignType]}</span></td>
                  <td><span className={`chip ${k.effective_status === "ACTIVE" ? "ok" : "mute"}`}>{k.effective_status}</span></td>
                  <td data-label="Budget">{budget !== null ? money(budget) : "—"}</td>
                  <td data-label="Spent">{money(spend)}</td>
                  <td data-label="Balance" style={balance !== null && balance < 0 ? { color: "var(--red)" } : undefined}>{balance !== null ? money(balance) : "—"}</td>
                  <td data-label="Share">{total > 0 ? `${Math.round((committed / total) * 100)}%` : "—"}</td>
                  <td>{c.period_start && <EditGoalButton campaignId={k.id} name={k.name} typeLabel={TYPE_LABEL[k.type as CampaignType]} periodStart={c.period_start} budget={budget} target={target} />}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="grid g2" style={{ marginBottom: 18 }}>
        <div className="card">
          <h3>Details</h3>
          {info.map(([l, v]) => <div className="dsum" key={l} style={{ cursor: "default" }}><span className="sub" style={{ margin: 0 }}>{l}</span><b>{v}</b></div>)}
        </div>
        <div className="card">
          <h3>Cost limits</h3>
          {limitRows.length === 0 ? <div className="sub" style={{ margin: 0 }}>No limits set</div> : limitRows.map(([t, v]) => (
            <div className="dsum" key={t} style={{ cursor: "default" }}><span className="sub" style={{ margin: 0 }}>{TYPE_LABEL[t as CampaignType] || t}</span><b>{limitText(t, Number(v))}</b></div>
          ))}
        </div>
      </div>

    </>
  );
}
