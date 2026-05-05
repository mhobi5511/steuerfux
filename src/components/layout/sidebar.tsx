"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { appName, navItems } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-full flex-col gap-4 rounded-2xl border border-line bg-white p-3 shadow-panel sm:p-4">
      <div className="rounded-2xl bg-slate-950 p-4 text-white">
        <p className="text-[11px] uppercase tracking-[0.25em] text-slate-300 sm:text-xs">
          Privater Bereich
        </p>
        <h1 className="mt-2 text-lg font-semibold">{appName}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Einfach, klar und nur fuer deine eigenen Buchhaltungsdaten.
        </p>
      </div>

      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:gap-2 lg:overflow-visible lg:px-0 lg:pb-0">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "whitespace-nowrap rounded-xl px-4 py-3 text-sm transition lg:px-3 lg:py-2",
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
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700 transition hover:bg-slate-100 md:min-h-10 md:px-3 md:py-2"
          type="submit"
        >
          <LogOut className="h-4 w-4" />
          Abmelden
        </button>
      </form>
    </aside>
  );
}
