// Turns the model's answer into clean, short, symbol-free content (pure functions, safe for client + server)
export type AiReport = {
  summary: string;
  campaigns: { name: string; status: "bad" | "warn" | "good"; note: string; action: string }[];
  actions: string[];
};

/** Remove markdown, emojis and decoration so plain text stays readable. */
export function cleanText(t: string): string {
  return t
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, "")
    .replace(/^\s*\|.*\|\s*$/gm, "")             // table rows
    .replace(/^\s*[-–—_=*]{3,}\s*$/gm, "")        // rules
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")           // headings
    .replace(/(\*\*|__|\*|`)/g, "")               // bold / italic / code marks
    .replace(/^\s*[-•*]\s+/gm, "")                // bullet marks
    .replace(/^\s*\d+[.)]\s+/gm, "")              // numbering
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const str = (v: unknown, max: number) => cleanText(String(v ?? "")).replace(/\s*\n\s*/g, " ").slice(0, max);

/** Parse the JSON report; returns null when the model did not follow the format. */
export function parseReport(raw: string): AiReport | null {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(raw.slice(a, b + 1));
    const campaigns = (Array.isArray(j.campaigns) ? j.campaigns : []).slice(0, 8).map((c: any) => ({
      name: str(c?.name, 80),
      status: (c?.status === "bad" || c?.status === "good" ? c.status : "warn") as "bad" | "warn" | "good",
      note: str(c?.note, 200),
      action: str(c?.action, 200),
    })).filter((c: any) => c.name);
    const actions = (Array.isArray(j.actions) ? j.actions : []).slice(0, 3).map((x: any) => str(x, 220)).filter(Boolean);
    const summary = str(j.summary, 400);
    if (!summary && campaigns.length === 0) return null;
    return { summary, campaigns, actions };
  } catch { return null; }
}
