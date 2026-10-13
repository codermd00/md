"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";

export type Series = {
  name: string; color: string; values: (number | null)[]; axis: "left" | "right";
  kind?: "line" | "bar"; fill?: boolean; fmt?: (v: number) => string;
};

const defFmt = (v: number) => (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toFixed(2));
const axisFmt = (v: number) => (v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + "k" : v < 1 && v > 0 ? v.toFixed(2) : v < 10 && !Number.isInteger(v) ? v.toFixed(1) : String(Math.round(v)));

/**
 * رسم SVG: كل مقياس (أيسر/أيمن) يُرسم في لوحة مستقلة تبدأ من الصفر، مع أيام المحور كاملة،
 * وقيمة كل نقطة (عند اتساع المكان) وشريط معلومات يعرض قيم اليوم المحدد (لمس/تمرير).
 */
export default function LineChart({ labels, series, height = 160, partialLast = false, split = true }: { labels: string[]; series: Series[]; height?: number; partialLast?: boolean; split?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(340);
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(260, Math.floor(el.clientWidth)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = labels.length;
  const groups = split ? (["left", "right"] as const).map((a) => series.filter((s) => s.axis === a)).filter((g) => g.length) : [series];
  const dual = !split && series.some((s) => s.axis === "right");
  const L = 36, R = dual ? 38 : 10, T = 18, B = 20;
  const pw = W - L - R;
  const x = (i: number) => L + (n === 1 ? pw / 2 : (i * pw) / (n - 1));
  const idx = sel !== null && sel < n ? sel : n - 1;
  const perDay = n > 1 ? pw / (n - 1) : pw;
  const showVals = perDay >= 26;                       // مكان كافٍ لرقم فوق كل نقطة
  const dayOnly = perDay < 30;                         // أيام فقط (بدون الشهر) عند الضيق
  const xStep = perDay >= 10 ? 1 : Math.ceil(10 / Math.max(perDay, 1));

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    setSel(Math.max(0, Math.min(n - 1, n === 1 ? 0 : Math.round(((px - L) / pw) * (n - 1)))));
  };

  if (n === 0) return <div className="empty" style={{ padding: 30 }}><b>No daily data</b></div>;

  const plot = (g: Series[], gi: number) => {
    const H = height;
    const maxOf = (a: "left" | "right") => Math.max(...g.filter((s) => s.axis === a).flatMap((s) => s.values.filter((v): v is number => v !== null)), 0) * 1.12 || 1;
    const mx = maxOf("left"), mr = maxOf("right");
    const y = (v: number, a: "left" | "right" = "left") => T + (H - T - B) * (1 - v / (a === "right" && dual ? mr : mx));
    const ticks = [0, 1 / 3, 2 / 3, 1];
    return (
      <div key={gi} style={{ marginTop: gi ? 6 : 0 }}>
        <svg width={W} height={H} style={{ display: "block", touchAction: "pan-y", cursor: "crosshair" }} onPointerDown={pick} onPointerMove={pick}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(mx * t)} y2={y(mx * t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
              <text x={L - 5} y={y(mx * t) + 3} textAnchor="end" fontSize="9.5" fill="var(--t3)">{axisFmt(mx * t)}</text>
              {dual && <text x={W - R + 5} y={y(mx * t) + 3} fontSize="9.5" fill="var(--t3)">{axisFmt(mr * t)}</text>}
            </g>
          ))}
          {labels.map((l, i) => i % xStep === 0 && (
            <text key={i} x={x(i)} y={H - 5} textAnchor="middle" fontSize="9.5" fill={i === idx ? "var(--text)" : "var(--t3)"} fontWeight={i === idx ? 700 : 400}>{dayOnly ? l.slice(8) : l.slice(5)}</text>
          ))}
          <line x1={x(idx)} x2={x(idx)} y1={T - 4} y2={H - B} stroke="var(--border2)" strokeWidth="1" />
          {g.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v, s.axis)] as const));
            let d = "", pen = false;
            for (const p of pts) { if (!p) { pen = false; continue; } d += (pen ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1) + " "; pen = true; }
            let solid = d, dash = "";
            if (partialLast && pts.length >= 2 && pts[pts.length - 1] && pts[pts.length - 2]) {
              const a = pts[pts.length - 2]!, b = pts[pts.length - 1]!;
              dash = `M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
              solid = d.slice(0, d.lastIndexOf("L")).trim();
              if (!solid.includes("L")) solid = "";
            }
            const first = pts.find((p) => p), last = [...pts].reverse().find((p) => p);
            const f = s.fmt || defFmt;
            return (
              <g key={s.name}>
                {s.fill && first && last && !d.includes("M", 1) && <path d={`${d}L${last[0].toFixed(1)} ${y(0)} L${first[0].toFixed(1)} ${y(0)} Z`} fill={s.color} opacity=".12" />}
                <path d={solid} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {dash && <path d={dash} fill="none" stroke={s.color} strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" opacity=".85" />}
                {pts.map((p, i) => p && (
                  <g key={i}>
                    <circle cx={p[0]} cy={p[1]} r={i === idx ? 4.2 : 2.6} fill={s.color} />
                    {(showVals || i === idx) && s.values[i] !== null && (
                      <text x={p[0]} y={s.axis === "right" && dual ? p[1] + 15 : p[1] - 7} textAnchor="middle" fontSize="9.5" fontWeight={i === idx ? 800 : 600} fill="var(--text)" stroke="var(--surface)" strokeWidth="3" paintOrder="stroke">{f(s.values[i] as number)}</text>
                    )}
                  </g>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  return (
    <div ref={box} style={{ width: "100%" }}>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline", fontSize: 12.5, marginBottom: 6 }}>
        <b>{labels[idx]}</b>
        {series.map((s) => (
          <span key={s.name} style={{ color: "var(--t2)" }}>
            <i style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: s.color, marginRight: 5 }} />{s.name}{" "}
            <b style={{ color: "var(--text)" }}>{s.values[idx] === null || s.values[idx] === undefined ? "—" : (s.fmt || defFmt)(s.values[idx] as number)}</b>
          </span>
        ))}
      </div>
      {groups.map(plot)}
    </div>
  );
}
