"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { appName, navItems } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { logout } from "@/app/actions/auth";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-4 shadow-panel">
      <div className="mb-6 rounded-2xl bg-slate-950 p-4 text-white">
        <p className="text-xs uppercase tracking-[0.25em] text-slate-300">Privater Bereich</p>
        <h1 className="mt-2 text-lg font-semibold">{appName}</h1>
        <p className="mt-2 text-sm text-slate-300">Einfach, klar und nur für deine eigenen Buchhaltungsdaten.</p>
      </div>

      <nav className="grid gap-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-xl px-3 py-2 text-sm transition",
              pathname === item.href
                ? "bg-brand-50 text-brand-700"
                : "text-slate-700 hover:bg-slate-100"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      <form action={logout} className="mt-auto">
        <button
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
          type="submit"
        >
          <LogOut className="h-4 w-4" />
          Abmelden
        </button>
      </form>
    </aside>
  );
}
