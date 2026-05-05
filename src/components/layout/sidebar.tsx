"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { logout } from "@/app/actions/auth";
import { appName, navItems } from "@/lib/constants";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  return (
    <>
      <div className="sticky top-0 z-40 -mx-3 mb-1 border-b border-slate-800 bg-slate-950/95 px-3 py-3 text-white backdrop-blur-xl sm:-mx-4 sm:px-4 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] text-slate-300">Buchhaltung</p>
            <p className="truncate text-base font-semibold text-white">{appName}</p>
          </div>
          <button
            type="button"
            aria-label={isOpen ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={isOpen}
            onClick={() => setIsOpen((value) => !value)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-white text-slate-950 shadow-sm transition hover:bg-slate-100"
          >
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Menü schließen"
            onClick={() => setIsOpen(false)}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
          />
          <aside className="absolute right-3 top-3 flex h-[calc(100vh-1.5rem)] w-[min(88vw,22rem)] flex-col rounded-[2rem] border border-slate-200 bg-slate-50/96 p-4 shadow-[0_30px_80px_-35px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-slate-800 dark:bg-slate-950/96">
            <div className="mb-4 rounded-[1.6rem] bg-[linear-gradient(135deg,#0f172a_0%,#1e3a8a_100%)] p-5 text-white">
              <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Privater Bereich</p>
              <h1 className="mt-2 text-xl font-semibold">{appName}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Schnell zu jedem Bereich springen und unterwegs direkt erfassen.
              </p>
            </div>

            <nav className="grid gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-2xl px-4 py-3 text-[15px] font-medium transition",
                    pathname === item.href
                      ? "bg-slate-950 text-white shadow-sm"
                      : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <form action={logout} className="mt-auto">
              <button
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                type="submit"
              >
                <LogOut className="h-4 w-4" />
                Abmelden
              </button>
            </form>
          </aside>
        </div>
      ) : null}

      <aside className="hidden h-full w-full flex-col gap-4 rounded-[2rem] border border-slate-200 bg-slate-50/90 p-4 shadow-[0_25px_60px_-35px_rgba(15,23,42,0.35)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/90 lg:flex">
        <div className="rounded-[1.6rem] bg-[linear-gradient(135deg,#0f172a_0%,#1e3a8a_100%)] p-5 text-white">
          <p className="text-[11px] uppercase tracking-[0.22em] text-slate-300">Privater Bereich</p>
          <h1 className="mt-2 text-xl font-semibold">{appName}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Einfach, klar und nur für deine eigenen Buchhaltungsdaten.
          </p>
        </div>

        <nav className="grid gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-2xl px-4 py-3 text-sm font-medium transition",
                pathname === item.href
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-700 hover:bg-slate-100"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form action={logout} className="mt-auto">
          <button
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            type="submit"
          >
            <LogOut className="h-4 w-4" />
            Abmelden
          </button>
        </form>
      </aside>
    </>
  );
}
