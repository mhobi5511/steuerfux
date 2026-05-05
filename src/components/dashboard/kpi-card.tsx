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
    <Card className="space-y-2">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-semibold text-slate-950">{value}</p>
      {note ? <p className="text-xs text-slate-500">{note}</p> : null}
    </Card>
  );
}
