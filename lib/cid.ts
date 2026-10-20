import { cookies, headers } from "next/headers";

// The client picked in the sidebar, shared while moving between pages (cookie "cid"; empty = all clients).
// A full page load (open / refresh) always starts from All clients: only in-app navigation requests (RSC) use the cookie.
export function savedCid(valid?: { id: string }[]): string {
  if (!headers().get("rsc")) return "";
  const v = cookies().get("cid")?.value || "";
  return !valid || valid.some((c) => c.id === v) ? v : "";
}
