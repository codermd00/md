import { createBrowserClient } from "@supabase/ssr";

/**
 * عميل Supabase الخاص بالمتصفح (Frontend).
 * يستخدم anon key فقط — لا يصل إطلاقاً إلى Meta Access Token أو Service Role Key.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
