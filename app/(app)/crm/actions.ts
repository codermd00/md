"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

export async function setOrderGovernorate(id: string, governorate: string) {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false };
  const { error } = await sb.from("crm_orders").update({ governorate: governorate || null }).eq("id", id);
  revalidatePath("/crm");
  return { ok: !error };
}

export async function deleteOrder(id: string) {
  const sb = createServerSupabase();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return { ok: false };
  const { error } = await sb.from("crm_orders").delete().eq("id", id);
  revalidatePath("/crm");
  return { ok: !error };
}
