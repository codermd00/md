import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * عميل Supabase على السيرفر مرتبط بجلسة المستخدم (Server Components / Route Handlers).
 * يُستخدم في كل صفحات القراءة/الكتابة العادية — يمر عبر RLS.
 */
export function createServerSupabase() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // استدعاء set من Server Component (بدون middleware) — يُتجاهل بأمان
            // لأن الـ middleware يتكفّل بتحديث الجلسة على أي حال
          }
        },
      },
    }
  );
}

/**
 * عميل إداري (Admin) يستخدم Service Role Key ويتجاوز RLS بالكامل.
 * يُستخدم فقط داخل مسارات المزامنة (/api/sync/*) التي تتحدث مع Meta API،
 * ولا يجب استدعاؤه أبداً من أي كود يعمل في المتصفح.
 */
export function createAdminSupabase() {
  return createRawClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
