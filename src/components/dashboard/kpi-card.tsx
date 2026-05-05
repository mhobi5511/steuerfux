import { Card } from "@/components/ui/card";

export function KpiCard({
  label,
  value,
  note
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <Card className="space-y-2 rounded-[2rem] bg-slate-100/80 dark:bg-slate-900">
      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="text-[1.85rem] font-semibold tracking-[-0.03em] text-slate-950 sm:text-2xl">{value}</p>
      {note ? <p className="hidden text-sm leading-6 text-slate-500 sm:block">{note}</p> : null}
    </Card>
  );
}
