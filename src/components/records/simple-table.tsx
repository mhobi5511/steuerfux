import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function SimpleTable({
  title,
  columns,
  rows,
  emptyText
}: {
  title: string;
  columns: string[];
  rows: ReactNode[][];
  emptyText: string;
}) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-sm text-slate-500 sm:px-5">{emptyText}</div>
      ) : (
        <div>
          <div className="grid gap-3 p-3 md:hidden">
            {rows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-4 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.25)]"
              >
                <div className="space-y-3">
                  {row.map((cell, cellIndex) => (
                    <div
                      key={cellIndex}
                      className={cellIndex === row.length - 1 ? "pt-2" : "border-b border-slate-100 pb-3"}
                    >
                      <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">
                        {columns[cellIndex] ?? `Feld ${cellIndex + 1}`}
                      </p>
                      <div className="mt-1 text-sm leading-6 text-slate-700">{cell}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-3 py-3 font-medium sm:px-4">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t border-line">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-3 align-top text-slate-700 sm:px-4">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

export function DeleteButton({
  action,
  id
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
}) {
  return (
    <form action={action}>
      <input name="id" type="hidden" value={id} />
      <Button type="submit" variant="ghost">
        Löschen
      </Button>
    </form>
  );
}
