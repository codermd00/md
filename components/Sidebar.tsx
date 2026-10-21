"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const I = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const ITEMS = [
  { href: "/overview", label: "Overview", icon: "M3 12l9-9 9 9M5 10v10h14V10" },
  { href: "/clients", label: "Clients", icon: "M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 11a4 4 0 100-8 4 4 0 000 8M21 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8" },
  { href: "/performance", label: "Performance", icon: "M3 3v18h18M7 15l4-4 3 3 5-6" },
  { href: "/watch", label: "Watch", icon: "M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 15a3 3 0 100-6 3 3 0 000 6z" },
  { href: "/content", label: "Content Manager", icon: "M4 4h16v16H4zM4 9h16M9 9v11" },
  { href: "/tasks", label: "Tasks & Notes", icon: "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" },
  { href: "/crm", label: "CRM Messages", icon: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" },
  { href: "/settings", label: "Settings", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" },
];

const TAB_HREFS = ["/overview", "/performance", "/watch", "/content", "/crm"];
const TAB_LABEL: Record<string, string> = { "/overview": "Overview", "/clients": "Clients", "/performance": "Perf", "/watch": "Watch", "/content": "Content", "/crm": "CRM" };

const CLIENT_PAGES = ["/performance", "/watch", "/content", "/tasks", "/crm"];

export default function Sidebar({ clients }: { clients: { id: string; name: string }[] }) {
  const path = usePathname();
  const router = useRouter();
  const [more, setMore] = useState(false);
  // The picked client lives here while you move between pages, and travels in the ?client= part of the page links.
  // A full page load (open / refresh) starts again from All clients.
  const [cid, setCid] = useState("");
  const sp = useSearchParams();
  const linked = sp.get("client") || "";
  const fresh = useRef(true);
  useEffect(() => {
    if (fresh.current) {
      fresh.current = false;
      if (linked) {   // refreshed on a client link: drop it and show All
        const rest = new URLSearchParams(window.location.search); rest.delete("client"); rest.delete("period");
        router.replace(path + (rest.toString() ? "?" + rest.toString() : ""));
        router.refresh();
      }
      return;
    }
    if (clients.some((c) => c.id === linked)) setCid(linked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linked]);
  useEffect(() => {
    const on = (e: Event) => setCid(String((e as CustomEvent).detail || ""));
    window.addEventListener("cid-change", on);
    return () => window.removeEventListener("cid-change", on);
  }, []);
  const href = (h: string) => (cid && CLIENT_PAGES.includes(h) ? `${h}?client=${cid}` : h);
  useEffect(() => setMore(false), [path]);
  const moreItems = ITEMS.filter((x) => !TAB_HREFS.includes(x.href));
  const moreOn = moreItems.some((x) => path.startsWith(x.href));

  function pick(id: string) {
    setCid(id);
    if (CLIENT_PAGES.some((p) => path.startsWith(p))) {
      const q = new URLSearchParams(window.location.search);
      q.delete("client"); q.delete("period");
      if (id) q.set("client", id);
      router.push(path + (q.toString() ? "?" + q.toString() : ""));
      router.refresh();
    }
  }
  const picker = (
    <select value={cid} onChange={(e) => pick(e.target.value)}>
      <option value="">All clients</option>
      {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  function toggleTheme() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    if (dark) document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", "dark");
    try { localStorage.setItem("theme", dark ? "light" : "dark"); } catch {}
  }
  async function logout() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sidebar">
      <div className="brand"><i>A</i> Ads Dashboard</div>
      <nav className="nav">
        {ITEMS.map((it) => (
          <Link key={it.href} href={href(it.href)} className={path.startsWith(it.href) ? "on" : ""}>
            {I(it.icon)} {it.label}
          </Link>
        ))}
      </nav>
      <div className="side-sel">{picker}</div>
      <div className="side-foot">
        <button onClick={toggleTheme}>{I("M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z")} Light / Dark</button>
        <button onClick={logout}>{I("M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9")} Logout</button>
      </div>
      <nav className="bnav">
        {ITEMS.filter((x) => TAB_HREFS.includes(x.href)).map((it) => (
          <Link key={it.href} href={href(it.href)} className={path.startsWith(it.href) ? "on" : ""}>{I(it.icon)}<span>{TAB_LABEL[it.href]}</span></Link>
        ))}
        <button className={moreOn || more ? "on" : ""} onClick={() => setMore(!more)}>{I("M5 12h.01M12 12h.01M19 12h.01")}<span>More</span></button>
      </nav>
      {more && (
        <div className="sheet-bg" onClick={() => setMore(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="side-sel">{picker}</div>
            {moreItems.map((it) => <Link key={it.href} href={href(it.href)} className={path.startsWith(it.href) ? "on" : ""}>{I(it.icon)} {it.label}</Link>)}
            <button onClick={toggleTheme}>{I("M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z")} Light / Dark</button>
            <button onClick={logout}>{I("M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9")} Logout</button>
          </div>
        </div>
      )}
    </aside>
  );
}
