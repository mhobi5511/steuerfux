import type { ReactNode } from "react";

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-700">
      <span className="text-[15px] font-medium text-slate-900 md:text-sm">{label}</span>
      {children}
      {hint ? <span className="hidden text-xs text-slate-500 md:block">{hint}</span> : null}
    </label>
  );
}
