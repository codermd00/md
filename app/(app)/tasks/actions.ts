"use server";
import { revalidatePath } from "next/cache";
import { createServerSupabase } from "@/lib/supabase/server";

async function requireUser() {
  const sb = createServerSupabase();
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new Error("غير مصرّح");
  return sb;
}
const done = (ok: boolean, message = "") => { revalidatePath("/tasks"); revalidatePath("/overview"); return { ok, message }; };

export type TaskInput = { id?: string; title: string; priority: "high" | "med" | "low"; client_id: string; due_date: string };

export async function saveTask(i: TaskInput) {
  const sb = await requireUser();
  const title = i.title.trim();
  if (!title) return { ok: false, message: "العنوان مطلوب" };
  const row = { title: title.slice(0, 300), priority: i.priority, client_id: i.client_id || null, due_date: i.due_date || null };
  const { error } = i.id ? await sb.from("tasks").update(row).eq("id", i.id) : await sb.from("tasks").insert(row);
  return error ? { ok: false, message: error.message } : done(true);
}
export async function toggleTask(id: string, isDone: boolean) {
  const sb = await requireUser();
  const { error } = await sb.from("tasks").update({ status: isDone ? "done" : "pending", done_at: isDone ? new Date().toISOString() : null }).eq("id", id);
  return done(!error, error?.message);
}
export async function deleteTask(id: string) {
  const sb = await requireUser();
  const { error } = await sb.from("tasks").delete().eq("id", id);
  return done(!error, error?.message);
}

export type NoteInput = { id?: string; title: string; body: string };
export async function saveNote(i: NoteInput) {
  const sb = await requireUser();
  if (!i.body.trim() && !i.title.trim()) return { ok: false, message: "اكتب ملاحظة" };
  const row = { title: i.title.trim().slice(0, 200) || null, body: i.body.slice(0, 5000) };
  const { error } = i.id ? await sb.from("notes").update(row).eq("id", i.id) : await sb.from("notes").insert(row);
  return error ? { ok: false, message: error.message } : done(true);
}
export async function deleteNote(id: string) {
  const sb = await requireUser();
  const { error } = await sb.from("notes").delete().eq("id", id);
  return done(!error, error?.message);
}
