import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold text-slate-950 sm:text-2xl">{title}</h1>
        <p className="max-w-3xl text-[15px] leading-6 text-slate-600 sm:text-sm">{description}</p>
      </div>
      {actions ? <div>{actions}</div> : null}
    </div>
  );
}
