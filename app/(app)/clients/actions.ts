"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";
import { syncClient, syncAll } from "@/lib/sync";
import { normAct } from "@/lib/meta";

async function requireUser() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error("غير مصرّح");
  return sb;
}

export type ClientInput = {
  id?: string; name: string; ig_username: string; ad_account_id: string;
  period_start: string; period_end: string; budget: string; business_type: string; city: string;
  page_id: string; ig_user_id: string; run_posts: boolean;
};

export async function saveClient(input: ClientInput): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const name = input.name.trim();
  const acc = normAct(input.ad_account_id);
  if (!name) return { ok: false, message: "الاسم مطلوب" };
  if (!/^\d{6,}$/.test(acc)) return { ok: false, message: "رقم الحساب الإعلاني غير صحيح" };
  if (input.period_start && input.period_end && input.period_end < input.period_start)
    return { ok: false, message: "نهاية الفترة قبل بدايتها" };

  const pageId = input.page_id.trim(), igId = input.ig_user_id.trim();
  if ((pageId && !/^\d{5,}$/.test(pageId)) || (igId && !/^\d{5,}$/.test(igId)))
    return { ok: false, message: "Page ID / Instagram ID أرقام فقط" };
  for (const [col, v] of [["page_id", pageId], ["ig_user_id", igId]] as const) {
    if (!v) continue;
    const { data: dup } = await sb.from("clients").select("name").eq(col, v).neq("id", input.id || "00000000-0000-0000-0000-000000000000").limit(1);
    if (dup?.length) return { ok: false, message: `${col === "page_id" ? "Page ID" : "Instagram ID"} مسجل مسبقاً للعميل «${dup[0].name}»` };
  }

  const row = {
    page_id: pageId || null, ig_user_id: igId || null, run_posts: !!input.run_posts,
    name, ad_account_id: acc,
    ig_username: input.ig_username.trim().replace(/^@/, "") || null,
    period_start: input.period_start || null, period_end: input.period_end || null,
    budget: Number(input.budget) || 0,
    business_type: input.business_type.trim() || null, city: input.city.trim() || null,
  };
  let id = input.id;
  if (id) {
    const { error } = await sb.from("clients").update(row).eq("id", id);
    if (error) return { ok: false, message: error.code === "23505" ? "هذا الحساب الإعلاني مسجل لعميل آخر" : error.message };
  } else {
    const { data, error } = await sb.from("clients").insert(row).select("id").single();
    if (error) return { ok: false, message: error.code === "23505" ? "هذا الحساب الإعلاني مسجل لعميل آخر" : error.message };
    id = data.id;
  }
  const r = await syncClient(id!);
  revalidatePath("/clients");
  return { ok: true, message: r.ok ? `تم الحفظ والمزامنة (${r.detail})` : `تم الحفظ لكن المزامنة فشلت: ${r.detail}` };
}

export async function deleteClient(id: string): Promise<{ ok: boolean; message: string }> {
  const sb = await requireUser();
  const { error } = await sb.from("clients").delete().eq("id", id);
  if (error) return { ok: false, message: error.message };
  revalidatePath("/clients");
  return { ok: true, message: "تم الحذف" };
}

export async function syncNow(id?: string): Promise<{ ok: boolean; message: string }> {
  await requireUser();
  if (id) {
    const r = await syncClient(id);
    revalidatePath("/clients"); revalidatePath(`/clients/${id}`);
    return { ok: r.ok, message: r.detail };
  }
  const rs = await syncAll();
  revalidatePath("/clients");
  const bad = rs.filter((r) => !r.ok);
  return { ok: bad.length === 0, message: bad.length ? `${bad.length} فشل: ${bad[0].detail}` : `تمت مزامنة ${rs.length} عميل` };
}
