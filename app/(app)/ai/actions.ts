"use server";
import { createServerSupabase } from "@/lib/supabase/server";
import { askAI } from "@/lib/ai";
import { buildContext } from "@/lib/ai-context";
import { cleanText, parseReport, type AiReport } from "@/lib/ai-report";

const BASE = `You are a senior Meta (Facebook/Instagram) ads analyst helping one media buyer manage clients.
You receive a JSON snapshot of ONE client's period. Rules:
- Write in simple Iraqi-friendly Arabic; keep numbers, campaign names and technical terms in English.
- Never sum or compare different result types (messages, reach, visits, engagement); reach cost is per 1,000 reached.
- Use only the numbers in the data. If data is missing or the sample is small, say so; do not invent.
- The person can already see the raw numbers on screen. NEVER just repeat spend, results or cost back. Every point must be a judgment: is it good or bad, WHY (compare with the client's cost limit, with the other ad sets or campaigns of the same client, with the earlier days trend, with other platforms, placements, ages, genders or regions that did better or worse, and with pacing vs target), and what to do about it.
- Breakdown tables (region, age, gender, platform, placement) can be incomplete. If a breakdown shows spend but zero results for every row, ignore that breakdown completely: do not mention it, do not call it a tracking or data error, and never advise stopping a campaign because of it.
- Be short and clear. No markdown, no headings, no asterisks, no hashes, no emojis, no tables, no decoration. Plain words only.`;

const REPORT_SYSTEM = BASE + `
Reply with ONE JSON object and nothing else, exactly in this shape:
{"summary": "one or two short sentences: the overall verdict for this client",
 "campaigns": [{"name": "campaign name exactly as given", "status": "bad" | "warn" | "good", "note": "the reason: why it is good or bad, with the one or two numbers that prove it", "action": "what to do (empty string if nothing)"}],
 "actions": ["the 3 most important things to do now, each one concrete (which ad set, platform or placement to change)"]}
Use "bad" for late or too expensive, "warn" for needs attention, "good" for fine. Only include campaigns that matter. Each sentence at most 25 words.`;

const ASK_SYSTEM = BASE + `
Answer the question directly, in this order, each on its own line, at most 8 lines in total:
first the verdict (good, bad or mixed) in one sentence; then the reasons with the key numbers and the comparison that proves them; then what to do. If the question is about one ad set or campaign, compare it with its siblings and with the client's cost limit.`;

export async function analyzeClient(clientId: string, question: string, periodStart?: string): Promise<{ ok: boolean; text: string; report?: AiReport }> {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) return { ok: false, text: "Unauthorized" };
  const ctx = await buildContext(sb, clientId, periodStart || null);
  if (!ctx) return { ok: false, text: "Client not found" };
  const q = question.trim().slice(0, 1000);
  if (q) {
    const r = await askAI(ASK_SYSTEM, `DATA:\n${ctx}\n\nQUESTION:\n${q}`);
    return { ok: r.ok, text: r.ok ? cleanText(r.text) : r.text };
  }
  const r = await askAI(REPORT_SYSTEM, `DATA:\n${ctx}\n\nAnalyze this client's current situation.`);
  if (!r.ok) return { ok: false, text: r.text };
  const report = parseReport(r.text);
  return report ? { ok: true, text: "", report } : { ok: true, text: cleanText(r.text) };
}
