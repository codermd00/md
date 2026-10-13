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
        {num("late_threshold", "حد التأخر % (أقل منه = متأخر)")}
        {num("goal_risk_days", "تنبيه قرب نهاية الفترة (أيام)")}
        {num("day_hours", "ساعات «اليوم» في الإعلان")}
        {num("default_budget", "ميزانية المنشور الافتراضية ($)")}
        {num("default_days", "أيام المنشور الافتراضية")}
        {num("sync_interval", "Auto sync every (minutes, min 5)")}
      </div>
      <h3 style={{ marginTop: 20 }}>Telegram Notifications</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
        {chk("notify_new_post", "منشور جديد")}
        {chk("notify_run_done", "اكتمال التشغيل")}
        {chk("notify_error", "الأخطاء")}
      </div>
      <div style={{ marginTop: 18 }}><button className="btn pri" disabled={pending}>{pending ? "..." : "حفظ"}</button></div>
      {msg && <div className={`msg ${msg.ok ? "" : "err"}`}>{msg.text}</div>}
    </form>
  );
}
