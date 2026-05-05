import { NextResponse } from "next/server";
import { getModuleData } from "@/lib/data";
import { isIncomePaid } from "@/lib/income-status";

function toCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(";"),
    ...rows.map((row) =>
      headers
        .map((header) => `"${String(row[header] ?? "").replaceAll('"', '""')}"`)
        .join(";")
    )
  ];
  return lines.join("\n");
}

export async function GET(
  request: Request,
  { params }: { params: { type: string } }
) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());
  const data = await getModuleData(year);

  const map: Record<string, Record<string, unknown>[]> = {
    einnahmen: data.incomes,
    ausgaben: data.expenses,
    bankgebuehren: data.fees,
    fahrten: data.trips,
    abschreibungen: data.depreciations,
    jahresuebersicht: [
      {
        jahr: year,
        berichtswaehrung: data.settings?.reporting_currency ?? "EUR",
        einnahmen_gesamt: data.incomes.reduce((sum, row) => sum + (row.payment_received_reporting ?? 0), 0),
        offene_einnahmen: data.incomes.reduce(
          (sum, row) => sum + (isIncomePaid(row.status) ? 0 : (row.difference_reporting ?? 0)),
          0
        ),
        ausgaben: data.expenses.reduce(
          (sum, row) =>
            sum +
            (row.effective_deductible_amount_reporting ?? row.deductible_amount_reporting ?? 0),
          0
        ),
        kundenbeteiligung_ausgaben: data.expenses.reduce(
          (sum, row) => sum + (row.client_share_amount_reporting ?? 0),
          0
        ),
        effektive_ausgaben: data.expenses.reduce(
          (sum, row) => sum + (row.effective_amount_reporting ?? row.amount_reporting ?? 0),
          0
        ),
        bank_und_wechselgebuehren: data.fees.reduce((sum, row) => sum + (row.amount_reporting ?? 0), 0),
        fahrten: data.trips.reduce((sum, row) => sum + (row.driving_deduction_reporting ?? 0), 0),
        reisekosten: data.trips.reduce((sum, row) => sum + (row.total_travel_expenses_reporting ?? 0), 0),
        verpflegungspauschalen: data.trips.reduce((sum, row) => sum + (row.total_per_diem_reporting ?? 0), 0),
        abschreibungen: data.depreciations.reduce((sum, row) => sum + (row.yearly_amount_reporting ?? 0), 0)
      }
    ]
  };

  const rows = map[params.type];
  if (!rows) {
    return NextResponse.json({ error: "Unbekannter Exporttyp." }, { status: 404 });
  }

  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${params.type}-${year}.csv"`
    }
  });
}
