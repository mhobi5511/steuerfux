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
    <Card className="space-y-3 rounded-[2rem] bg-[linear-gradient(180deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)]">
      <p className="text-[13px] font-medium uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="text-[1.85rem] font-semibold tracking-[-0.03em] text-slate-950 sm:text-2xl">{value}</p>
      {note ? <p className="text-sm leading-6 text-slate-500">{note}</p> : null}
    </Card>
  );
}
