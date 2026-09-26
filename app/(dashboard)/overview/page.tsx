import { createServerSupabase } from "@/lib/supabase/server";

export default async function OverviewPage() {
  const supabase = createServerSupabase();

  const today = new Date().toISOString().split("T")[0];

  const { data: insights } = await supabase
    .from("daily_insights")
    .select("spend, impressions, reach, clicks, results")
    .eq("level", "account")
    .eq("date", today);

  const totals = (insights ?? []).reduce(
    (acc, row) => {
      acc.spend += Number(row.spend ?? 0);
      acc.impressions += Number(row.impressions ?? 0);
      acc.reach += Number(row.reach ?? 0);
      acc.clicks += Number(row.clicks ?? 0);
      acc.results += Number(row.results ?? 0);
      return acc;
    },
    { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0 }
  );

  const { count: openAlertsCount } = await supabase
    .from("alerts")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  return (
    <div>
      <h2>Overview</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 13 }}>بيانات اليوم — {today}</p>

      <div className="kpi-grid">
        <Kpi label="Total Spend" value={`$${totals.spend.toFixed(2)}`} />
        <Kpi label="Total Results" value={totals.results.toFixed(0)} />
        <Kpi label="Reach" value={totals.reach.toLocaleString()} />
        <Kpi label="Impressions" value={totals.impressions.toLocaleString()} />
        <Kpi label="Clicks" value={totals.clicks.toLocaleString()} />
        <Kpi label="Open Alerts" value={String(openAlertsCount ?? 0)} />
      </div>

      <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 28 }}>
        قسم "What Needs Attention" وربط التنبيهات بالعناصر يُبنى في المرحلة 4 من خطة التنفيذ،
        بعد إكمال محرك التحليل (Analysis Engine).
      </p>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="kpi-card">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
