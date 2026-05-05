import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "min-w-0 max-w-full rounded-[1.75rem] border border-slate-200/80 bg-slate-50/95 p-4 shadow-[0_20px_55px_-35px_rgba(15,23,42,0.3)] backdrop-blur-xl sm:p-5 dark:border-slate-800 dark:bg-slate-900/90",
        className
      )}
      {...props}
    />
  );
}
