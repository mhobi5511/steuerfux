import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";

const monthFormatter = new Intl.DateTimeFormat("de-DE", { month: "long" });

function getMonthOptions() {
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const label = monthFormatter.format(new Date(2026, index, 1));

    return {
      value: String(month),
      label: label.charAt(0).toUpperCase() + label.slice(1)
    };
  });
}

export function getSelectedMonth(value: string | undefined) {
  if (value === "all") {
    return "all";
  }

  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
    return String(parsed);
  }

  return String(new Date().getMonth() + 1);
}

export function matchesSelectedMonth(
  value: string | null | undefined,
  selectedMonth: string
) {
  if (selectedMonth === "all") {
    return true;
  }

  if (!value) {
    return false;
  }

  return new Date(value).getMonth() + 1 === Number(selectedMonth);
}

export function MonthFilter({
  action,
  selectedMonth,
  editId
}: {
  action: string;
  selectedMonth: string;
  editId?: string;
}) {
  const resetHref = editId ? `${action}?edit=${editId}&month=all` : `${action}?month=all`;

  return (
    <Card className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-950">Liste filtern</h2>
        <p className="hidden text-sm text-slate-600 sm:block">
          Standardmäßig wird der aktuelle Monat gezeigt. Auf Wunsch kannst du alle Monate einblenden.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        {editId ? <input name="edit" type="hidden" value={editId} /> : null}
        <label className="space-y-1 text-sm text-slate-700">
          <span>Monat</span>
          <Select name="month" defaultValue={selectedMonth} className="w-full sm:w-52">
            <option value="all">Alle Monate</option>
            {getMonthOptions().map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" variant="secondary" className="w-full sm:w-auto">
          Anwenden
        </Button>
        <Link
          href={resetHref}
          className="inline-flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-100 md:min-h-10 md:py-2"
        >
          Alle Monate
        </Link>
      </form>
    </Card>
  );
}
