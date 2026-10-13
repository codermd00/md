"use client";
import { useState, useTransition } from "react";
import { saveSettings } from "@/app/(app)/settings/actions";

type S = Record<string, any>;

export default function SettingsForm({ s }: { s: S }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const num = (k: string, label: string) => (
    <label className="f">{label}<input name={k} type="number" step="any" defaultValue={s[k]} required /></label>
  );
  const chk = (k: string, label: string) => (
    <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600 }}>
      <input type="checkbox" name={k} defaultChecked={!!s[k]} style={{ width: 16 }} /> {label}
    </label>
  );
  return (
    <form
      className="card"
      action={(fd) => start(async () => { const r = await saveSettings(fd); setMsg({ ok: r.ok, text: r.message }); })}
    >
      <h3>Defaults</h3>
      <div className="grid g2" style={{ marginTop: 14 }}>
        {num("late_threshold", "Late threshold (%)")}
        {num("goal_risk_days", "Period ending alert (days)")}
        {num("day_hours", "Hours per ad day")}
        {num("default_budget", "Default post budget ($)")}
        {num("default_days", "Default post days")}
        {num("sync_interval", "Auto sync every (minutes, min 5)")}
      </div>
      <h3 style={{ marginTop: 20 }}>Cost Alerts</h3>
      <div style={{ marginTop: 10 }}>
        <label className="f">Alert times (Baghdad, HH:MM, comma separated)<input name="alert_times" defaultValue={s.alert_times || "12:00,18:00"} /></label>
      </div>
      <h3 style={{ marginTop: 20 }}>Telegram Notifications</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {chk("notify_new_post", "New post")}
        {chk("notify_run_done", "Run completed")}
        {chk("notify_error", "Errors")}
      </div>
      <div style={{ marginTop: 18 }}><button className="btn pri" disabled={pending}>{pending ? "..." : "Save"}</button></div>
      {msg && <div className={`msg ${msg.ok ? "" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
