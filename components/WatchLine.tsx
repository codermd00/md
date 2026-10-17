import type { WatchRow } from "@/lib/watch";

export const FLAG_COLOR: Record<WatchRow["flag"], string> = {
  stop: "var(--red)", worse: "var(--red)", over: "var(--orange)", better: "var(--green)", same: "var(--t3)", new: "var(--t3)",
};
export const FLAG_TEXT: Record<WatchRow["flag"], string> = {
  stop: "No spend", worse: "Worse", over: "Over limit", better: "Better", same: "Steady", new: "Collecting",
};
export const LEVEL: Record<WatchRow["level"], string> = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };

export default function WatchLine({ r }: { r: WatchRow }) {
  return (
    <div className="dsum" style={{ cursor: "default", alignItems: "flex-start" }}>
      <span style={{ minWidth: 0 }}>
        <span className="wdotl" style={{ background: FLAG_COLOR[r.flag] }} />
        <b>{r.name}</b>
        <div className="sub" style={{ margin: 0 }}>{r.clientName} · {r.parentCamp ? `${r.parentCamp}${r.parentAdset ? " › " + r.parentAdset : ""}` : LEVEL[r.level]} · day {r.days}</div>
      </span>
      <span style={{ textAlign: "right", flex: "none" }}>
        <b style={{ color: FLAG_COLOR[r.flag] }}>{r.before !== "—" ? `${r.before} → ` : ""}{r.cost}</b>
        <div className="sub" style={{ margin: 0 }}>{r.error ? "Meta error" : FLAG_TEXT[r.flag]}</div>
      </span>
    </div>
  );
}
