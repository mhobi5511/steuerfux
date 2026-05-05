import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { requireUser } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  await requireUser();

  return (
    <div className="mx-auto grid min-h-screen max-w-[1600px] gap-6 px-4 py-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)]">
        <Sidebar />
      </div>
      <main className="space-y-6">{children}</main>
    </div>
  );
}
