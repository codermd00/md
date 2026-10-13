import Link from "next/link";
import { notFound } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { daysLeft } from "@/lib/dates";
import { TYPE_LABEL, formatCpr, type CampaignType } from "@/lib/results";

export const dynamic = "force-dynamic";
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const MIN_SPEND = 0;

export default async function ClientPage({ params }: { params: { id: string } }) {
  const sb = createServerSupabase();
  const { data: c } = await sb.from("clients").select("*").eq("id", params.id).single();
  if (!c) notFound();

  const { data: camps } = await sb.from("campaigns").select("*").eq("client_id", c.id);
  const ids = (camps || []).map((k: any) => k.id);
  const { data: ranges } = ids.length
    ? await sb.from("insights_range").select("*").eq("level", "campaign").in("entity_id", ids).order("synced_at", { ascending: false })
    : { data: [] as any[] };

  const rows = (camps || [])
    .map((k: any) => {
      const r = (ranges || []).find((x: any) => x.entity_id === k.id && (!c.period_start || x.date_from === c.period_start));
      return { k, spend: r ? Number(r.spend) : 0, results: r ? Number(r.results) : 0 };
    })
    .filter((x: any) => x.spend > MIN_SPEND)
    .sort((a: any, b: any) => b.spend - a.spend);

  const totalSpend = rows.reduce((s: number, x: any) => s + x.spend, 0);
  const left = daysLeft(c.period_end);

  return (
    <>
      <Link href="/clients" className="back">← Clients</Link>
      <div className="topbar">
        <div>
          <div className="h1">{c.name}</div>
          <div className="sub">
            {c.ig_username ? `@${c.ig_username} · ` : ""}{c.period_start || "—"} → {c.period_end || "—"} · {money(Number(c.budget) || 0)}
          </div>
        </div>
        <span className={`chip ${c.account_status === "active" ? "ok" : c.account_status ? "bad" : "warn"}`}>{c.account_status || "Not synced"}</span>
      </div>

      <div className="grid g4" style={{ marginBottom: 18 }}>
        <div className="card"><div className="sub">Spend</div><div className="h1">{money(totalSpend)}</div></div>
        <div className="card"><div className="sub">Remaining</div><div className="h1">{money(Math.max(0, (Number(c.budget) || 0) - totalSpend))}</div></div>
        <div className="card"><div className="sub">Days left</div><div className="h1">{left === null ? "—" : left}</div></div>
        <div className="card"><div className="sub">Campaigns</div><div className="h1">{rows.length}</div></div>
      </div>

      <div className="card">
        <h3>Campaigns</h3>
        {rows.length === 0 ? (
          <div className="empty"><b>No campaigns with spend</b></div>
        ) : (
          <div style={{ overflowX: "auto" }}><table className="tbl tcards">
            <thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Spend</th><th>Results</th><th>CPR</th></tr></thead>
            <tbody>
              {rows.map(({ k, spend, results }: any) => (
                <tr key={k.id}>
                  <td><b>{k.name}</b></td>
                  <td><span className="chip mute">{TYPE_LABEL[k.type as CampaignType]}</span></td>
                  <td><span className={`chip ${k.effective_status === "ACTIVE" ? "ok" : "mute"}`}>{k.effective_status}</span></td>
                  <td data-label="Spend">{money(spend)}</td>
                  <td data-label="Results">{k.type === "other" ? "—" : results.toLocaleString("en-US")}</td>
                  <td data-label="CPR">{formatCpr(k.type as CampaignType, spend, results)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
