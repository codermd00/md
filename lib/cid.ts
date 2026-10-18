import { cookies } from "next/headers";

// The client picked in the sidebar, shared by every page (cookie "cid"; empty = all clients)
export function savedCid(valid?: { id: string }[]): string {
  const v = cookies().get("cid")?.value || "";
  return !valid || valid.some((c) => c.id === v) ? v : "";
}
