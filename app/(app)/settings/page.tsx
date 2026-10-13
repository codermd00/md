import { createServerSupabase } from "@/lib/supabase/server";
import ConnectivityTester from "@/components/ConnectivityTester";
import SettingsForm from "@/components/SettingsForm";
import PasswordForm from "@/components/PasswordForm";

export const dynamic = "force-dynamic";

const ENV: { key: string; label: string; required: boolean }[] = [
  { key: "META_ACCESS_TOKEN", label: "Meta Access Token", required: true },
  { key: "SUPABASE_SERVICE_ROLE_KEY", label: "Supabase Service Role", required: true },
  { key: "SYNC_SECRET", label: "Sync Secret", required: true },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", required: false },
  { key: "TELEGRAM_CHAT_ID", label: "Telegram Chat ID", required: false },
];

export default async function SettingsPage() {
  const sb = createServerSupabase();
  const [{ data: rows }, { data: logs }] = await Promise.all([
    sb.from("settings").select("key,value"),
    sb.from("sync_log").select("kind,ok,detail,created_at").order("created_at", { ascending: false }).limit(8),
  ]);
  const s: Record<string, any> = {};
  (rows || []).forEach((r: any) => (s[r.key] = r.value));
  if (!s.sync_interval) s.sync_interval = 15;
  const version = process.env.META_API_VERSION || "v24.0";

  return (
    <>
      <div className="topbar"><div><div className="h1">Settings</div></div></div>
      <div className="grid" style={{ maxWidth: 900 }}>
        <div className="card">
          <h3>Environment</h3>
          <div style={{ marginTop: 10 }}>
            {ENV.map((e) => {
              const set = !!process.env[e.key];
              return (
                <div className="kv" key={e.key}>
                  <span>{e.label}</span>
                  <span className={`chip ${set ? "ok" : e.required ? "bad" : "mute"}`}>{set ? "مضبوط" : e.required ? "ناقص" : "غير مفعّل"}</span>
                </div>
              );
            })}
            <div className="kv"><span>Meta API</span><span>{version}</span></div>
            <div className="kv"><span>Timezone</span><span>{process.env.APP_TIMEZONE || "Asia/Baghdad"}</span></div>
          </div>
        </div>

        <ConnectivityTester />
        <SettingsForm s={s} />

        <div className="card">
          <h3>Sync Log</h3>
          {logs?.length ? (
            <div style={{ marginTop: 10 }}>
              {logs.map((l: any, i: number) => (
                <div className="kv" key={i}>
                  <span>{l.kind} · {new Date(l.created_at).toLocaleString("en-GB", { timeZone: "Asia/Baghdad" })}</span>
                  <span className={`chip ${l.ok ? "ok" : "bad"}`}>{l.detail || (l.ok ? "OK" : "فشل")}</span>
                </div>
              ))}
            </div>
          ) : <div className="sub" style={{ marginTop: 8 }}>—</div>}
        </div>

        <PasswordForm />
      </div>
    </>
  );
}
