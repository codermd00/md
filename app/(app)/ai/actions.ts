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
- Breakdown tables (region, age, gender, platform, placement) can be incomplete. A missing or zero breakdown value is NOT a tracking or data error: never say tracking is broken and never advise stopping a campaign because of it.
- Be very short. No markdown, no headings, no asterisks, no hashes, no emojis, no tables, no decoration. Plain words only.`;

const REPORT_SYSTEM = BASE + `
Reply with ONE JSON object and nothing else, exactly in this shape:
{"summary": "one or two short sentences about the whole client",
 "campaigns": [{"name": "campaign name exactly as given", "status": "bad" | "warn" | "good", "note": "one short sentence: what is happening and the likely cause", "action": "one short sentence: what to do (empty string if nothing)"}],
 "actions": ["the 3 most important things to do now, one short sentence each"]}
Use "bad" for late or too expensive, "warn" for needs attention, "good" for fine. Only include campaigns that matter. Each sentence at most 20 words.`;

const ASK_SYSTEM = BASE + `
Answer the question in at most 6 short lines. Put each idea on its own line, no bullet characters.`;

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
