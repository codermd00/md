// Meta webhook (Messenger / Instagram DM) → CRM.  يُنشر كـ Supabase Edge Function باسم: meta-webhook
// الأسرار المطلوبة (Edge Functions → Secrets):  META_VERIFY_TOKEN   (اختياري: META_APP_SECRET للتحقق من التوقيع)
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY موجودان تلقائياً. عطّل "Verify JWT" لهذه الدالة.

// ============ منطق نقي (منقول من Apps Script v16) ============
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const toLatinDigits = (t: string) => t.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

/** استخراج الهاتف العراقي وتطبيعه إلى +964… وإرجاع النص دونه */
export function extractPhone(original: string): { phone: string | null; cleaned: string } {
  // drop invisible direction marks / zero-width chars and non-breaking spaces that chat apps insert around numbers
  const latin = toLatinDigits(original).replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").replace(/\u00A0/g, " ");
  const m = latin.match(/(?:\+?964|0)?\s*7[5789]\s*\d(?:\s*\d){7}\b/g);
  if (m && m[0]) {
    const found = m[0];
    let p = found.replace(/\s+/g, "");
    if (p.startsWith("0")) p = "+964" + p.substring(1);
    else if (p.startsWith("7")) p = "+964" + p;
    else if (p.startsWith("964")) p = "+" + p;
    return { phone: p, cleaned: latin.replace(found, "").trim() };
  }
  return { phone: null, cleaned: original };
}

const QUESTION_WORDS = ["؟", "?", "شكد", "بيش", "اكو", "متوفر", "هل", "توصلون", "رحت", "لكيت", "يبيعونه", "سعره", "عدكم", "للحجز", "رقمين", "عنوان"];
const ADDRESS_WORDS = ["بغداد", "اربيل", "السليمانية", "دهوك", "سليمانيه", "كركوك", "الموصل", "نينوى", "ديالى", "صلاح الدين", "الانبار", "الأنبار", "المثنى", "الناصرية", "ذي قار", "ميسان", "السماوه", "العمارة", "بابل", "بصرة", "القادسية", "النجف", "واسط", "كربلاء", "الديوانية", "الحلة", "الغزالية", "الكرادة", "المنصور", "الحي العسكري", "الزاد", "البلديات", "العبيدي", "الكرخ", "الراشد", "النهروان", "الشيخ عمر", "باب الشرجي", "مدينة الصدر", "بغداد الجديدة", "الشعب", "الكريعات", "اليرموك", "حي العامل", "العامرية", "الشعلة", "زيونة", "شارع فلسطين", "الربيعي", "الامين", "الحارثية", "الاعظمية", "الوزيرية", "السيدية", "الجادرية", "الدورة", "الكمالية", "الزعفرانية", "الحرية", "التاجي", "العامريه", "الزعفرانيه", "شارع"];

export function isLikelyAddress(text: string): boolean {
  if (!text || text.length < 3) return false;
  if (QUESTION_WORDS.some((k) => text.includes(k))) return false;
  return ADDRESS_WORDS.some((k) => text.includes(k));
}

/** توحيد عربي: همزات الألف، ى→ي، ة→ه، حذف التشكيل */
export const normAr = (s: string) =>
  s.replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").toLowerCase();

// المحافظة → كلمات دالة (بعد التوحيد). الترتيب مهم: الأخص أولاً، وأحياء بغداد في آخر القائمة.
const GOV_KEYWORDS: [string, string[]][] = [
  ["السليمانية", ["سليمانيه", "سليماني", "السليمانيه"]],
  ["أربيل", ["اربيل", "هولير", "عنكاوا"]],
  ["دهوك", ["دهوك", "زاخو"]],
  ["كركوك", ["كركوك"]],
  ["نينوى", ["نينوي", "الموصل", "موصل", "تلعفر"]],
  ["ديالى", ["ديالي", "بعقوبه", "الخالص", "خانقين"]],
  ["صلاح الدين", ["صلاح الدين", "تكريت", "سامراء", "بيجي"]],
  ["الأنبار", ["انبار", "الرمادي", "الفلوجه", "الرطبه", "حديثه"]],
  ["المثنى", ["مثني", "السماوه", "سماوه"]],
  ["ذي قار", ["ذي قار", "ذيقار", "الناصريه", "ناصريه", "سوق الشيوخ"]],
  ["ميسان", ["ميسان", "العماره", "عماره"]],
  ["بابل", ["بابل", "الحله", "حله", "المسيب", "الهاشميه"]],
  ["البصرة", ["بصره", "الزبير", "ابو الخصيب", "شط العرب", "القرنه"]],
  ["القادسية", ["القادسيه", "الديوانيه", "ديوانيه", "الشامية", "عفك"]],
  ["النجف", ["نجف", "الكوفه", "كوفه", "المناذره"]],
  ["واسط", ["واسط", "الكوت", "كوت", "الصويره", "النعمانيه"]],
  ["كربلاء", ["كربلاء", "كربلا", "الهنديه", "عين التمر"]],
  ["بغداد", ["بغداد", "الغزاليه", "الكراده", "المنصور", "الحي العسكري", "الزاد", "البلديات", "العبيدي", "الكرخ", "الراشد", "النهروان", "الشيخ عمر", "باب الشرجي", "مدينه الصدر", "الصدر", "الشعب", "الكريعات", "اليرموك", "حي العامل", "العاميريه", "العامريه", "الشعله", "زيونه", "شارع فلسطين", "الربيعي", "الامين", "الحارثيه", "الاعظميه", "الوزيريه", "السيديه", "الجادريه", "الدوره", "الكماليه", "الزعفرانيه", "الحريه", "التاجي", "ابو غريب", "المحموديه", "اليوسفيه", "الشعب", "حي اور", "البياع", "الجهاد", "الغدير", "الكاظميه", "الطوبجي", "الشرطه", "الحبيبيه", "بغداد الجديده", "القاهره", "ساحه عدن", "الاعلام", "المشتل", "الدورة"]],
];

/** المحافظة من نص العنوان أو null إن لم تُعرف */
export function detectGovernorate(address: string): string | null {
  const t = normAr(address);
  for (const [gov, kws] of GOV_KEYWORDS) if (kws.some((k) => t.includes(normAr(k)))) return gov;
  return null;
}

/** يوم بتوقيت بغداد YYYY-MM-DD */
export function baghdadDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}
const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) + n * 86400000).toISOString().slice(0, 10);

// ============ المعالجة (تحتاج قاعدة بيانات) ============
type Db = any;

async function findClient(db: Db, objectId: string) {
  const { data } = await db.from("clients").select("id").or(`page_id.eq.${objectId},ig_user_id.eq.${objectId}`).limit(1);
  return data?.[0]?.id as string | undefined;
}

export async function handleMessage(
  db: Db, clientId: string, senderId: string, text: string, tsMs: number, referral: any, platform?: "instagram" | "facebook"
): Promise<string> {
  const day = baghdadDay(tsMs);
  const adId: string | null = referral?.ad_id || null;
  const postId: string | null = referral?.ads_context_data?.post_id || null;

  // 1) المحادثة: مرسل جديد خلال آخر 7 أيام فقط
  const { data: recent } = await db.from("crm_conversations").select("first_day")
    .eq("client_id", clientId).eq("sender_id", senderId).gte("first_day", addDays(day, -7)).limit(1);
  if (!recent?.length) {
    await db.from("crm_conversations").upsert({ client_id: clientId, sender_id: senderId, first_day: day, ad_id: adId, post_id: postId },
      { onConflict: "client_id,sender_id,first_day", ignoreDuplicates: true });
  } else if (adId || postId) {
    await db.from("crm_conversations").update({ ad_id: adId, post_id: postId }).eq("client_id", clientId).eq("sender_id", senderId).is("ad_id", null);
  }

  // 2) الهاتف والعنوان
  const { phone, cleaned } = extractPhone(text);
  const addr = isLikelyAddress(cleaned) ? cleaned.trim() : "";
  if (!phone && !addr) return "skip";
  let gov = addr ? detectGovernorate(addr) : null;

  if (phone) {
    let address = addr;
    if (!address) {
      const { data: pend } = await db.from("crm_pending").select("*").eq("client_id", clientId).eq("sender_id", senderId).maybeSingle();
      if (pend && pend.day >= addDays(day, -3)) {
        address = pend.address; gov = pend.governorate;
        await db.from("crm_pending").delete().eq("client_id", clientId).eq("sender_id", senderId);
      }
    }
    let ad = adId, post = postId;
    if (!ad && !post) {
      const { data: conv } = await db.from("crm_conversations").select("ad_id,post_id").eq("client_id", clientId).eq("sender_id", senderId)
        .not("ad_id", "is", null).order("first_day", { ascending: false }).limit(1);
      ad = conv?.[0]?.ad_id || null; post = conv?.[0]?.post_id || null;
    }
    const { data: ex } = await db.from("crm_orders").select("id,address,ad_id,post_id,platform").eq("client_id", clientId).eq("phone", phone).eq("day", day).maybeSingle();
    if (ex) {
      const patch: Record<string, unknown> = {};
      if (address && !ex.address) { patch.address = address; patch.governorate = gov; }
      if (ad && !ex.ad_id) patch.ad_id = ad;
      if (post && !ex.post_id) patch.post_id = post;
      if (platform && !ex.platform) patch.platform = platform;
      if (Object.keys(patch).length) await db.from("crm_orders").update(patch).eq("id", ex.id);
      return "order_updated";
    }
    await db.from("crm_orders").insert({ client_id: clientId, phone, day, sender_id: senderId, address: address || null, governorate: gov, ad_id: ad, post_id: post, ...(platform ? { platform } : {}) });
    return "order_created";
  }

  // عنوان فقط: أكمل آخر طلب لنفس المرسل (آخر 3 أيام) بلا عنوان، وإلا احفظه معلّقاً
  const { data: target } = await db.from("crm_orders").select("id").eq("client_id", clientId).eq("sender_id", senderId)
    .or("address.is.null,address.eq.").gte("day", addDays(day, -3)).order("created_at", { ascending: false }).limit(1);
  if (target?.length) {
    await db.from("crm_orders").update({ address: addr, governorate: gov }).eq("id", target[0].id);
    return "address_attached";
  }
  await db.from("crm_pending").upsert({ client_id: clientId, sender_id: senderId, address: addr, governorate: gov, day, updated_at: new Date().toISOString() }, { onConflict: "client_id,sender_id" });
  return "address_pending";
}

async function verifySignature(secret: string, raw: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex === header.slice(7);
}

// ============ الخادم ============
declare const Deno: any;
if (typeof Deno !== "undefined") {
  Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const ok = url.searchParams.get("hub.verify_token") === Deno.env.get("META_VERIFY_TOKEN");
      return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const raw = await req.text();
    const secret = Deno.env.get("META_APP_SECRET");
    if (secret && !(await verifySignature(secret, raw, req.headers.get("x-hub-signature-256")))) {
      return new Response("bad signature", { status: 401 });
    }
    try {
      const payload = JSON.parse(raw);
      const results: string[] = [];
      for (const entry of payload.entry || []) {
        const clientId = await findClient(db, String(entry.id || ""));
        for (const ev of entry.messaging || []) {
          const m = ev.message;
          const sender = ev.sender?.id;
          if (!m || m.is_echo || !m.text || !sender) continue;
          if (!clientId) { results.push("unmatched"); continue; }
          results.push(await handleMessage(db, clientId, String(sender), String(m.text), Number(ev.timestamp) || Date.now(), m.referral || ev.referral, payload.object === "instagram" ? "instagram" : "facebook"));
        }
      }
      const unmatched = results.includes("unmatched");
      await db.from("webhook_log").insert({
        kind: unmatched ? "unmatched" : "ok",
        payload: unmatched ? payload : {
          results,
          // diagnostics only (no message text): which platform/page and what each event looked like
          object: payload.object,
          entries: (payload.entry || []).map((e: any) => ({
            id: e.id,
            events: (e.messaging || []).map((ev: any) => ({
              keys: Object.keys(ev).filter((k) => k !== "sender" && k !== "recipient" && k !== "timestamp"),
              text: !!ev.message?.text, echo: !!ev.message?.is_echo, attach: !!ev.message?.attachments?.length,
              ref: !!(ev.message?.referral || ev.referral),
              sample: String(ev.message?.text || "").slice(0, 40),
              odd: [...String(ev.message?.text || "").slice(0, 40)].map((c) => c.charCodeAt(0)).filter((c) => c > 127 || c < 32),
            })),
            changes: (e.changes || []).map((c: any) => c.field),
          })),
        },
        error: unmatched ? "page/ig id غير مربوط بأي عميل (راجع page_id في Clients)" : null,
      });
      if (Math.random() < 0.01) await db.from("webhook_log").delete().lt("created_at", new Date(Date.now() - 7 * 86400000).toISOString());
    } catch (e) {
      try { await db.from("webhook_log").insert({ kind: "error", payload: { raw: raw.slice(0, 4000) }, error: String(e) }); } catch { /* ignore */ }
    }
    return new Response("ok", { status: 200 }); // دائماً 200 لتفادي إعادة الإرسال من Meta
  });
}
