import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { getBuchhaltungContext } from "@/lib/data";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const { buchhaltungen, activeBuchhaltung } = await getBuchhaltungContext();

  return (
    <div className="mx-auto grid min-h-screen max-w-[1600px] gap-4 px-3 py-3 sm:gap-6 sm:px-4 sm:py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
        <Sidebar buchhaltungen={buchhaltungen} activeBuchhaltung={activeBuchhaltung} />
      </div>
      <main className="min-w-0 space-y-4 sm:space-y-6">{children}</main>
    </div>
  );
}
