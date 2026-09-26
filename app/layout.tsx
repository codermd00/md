import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meta Ads Dashboard",
};

const NAV_ITEMS = [
  { href: "/overview", label: "Overview" },
  { href: "/clients", label: "Clients" },
  { href: "/accounts", label: "Accounts" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/analytics", label: "Analytics" },
  { href: "/budget-planner", label: "Budget Planner" },
  { href: "/alerts", label: "Alerts" },
  { href: "/notes", label: "Notes" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <h1>Meta Ads Dashboard</h1>
            <nav>
              {NAV_ITEMS.map((item) => (
                <a key={item.href} href={item.href}>
                  {item.label}
                </a>
              ))}
            </nav>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
