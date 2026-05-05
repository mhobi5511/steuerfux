import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());
  const data = await getDashboardData(year);

  const html = `
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <title>Jahresreport ${year}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 32px; color: #0f172a; }
          h1, h2 { margin-bottom: 8px; }
          table { width: 100%; border-collapse: collapse; margin-top: 24px; }
          td, th { border: 1px solid #cbd5e1; padding: 10px; text-align: left; }
          th { background: #f8fafc; }
        </style>
      </head>
      <body>
        <h1>Jahresreport ${year}</h1>
        <p>Diese Ansicht kann direkt über den Browser als PDF gedruckt werden.</p>
        <p>Berichtswährung: ${data.reportingCurrency}</p>
        <table>
          <tr><th>Position</th><th>Wert</th></tr>
          <tr><td>Einnahmen gesamt</td><td>${formatCurrency(data.kpis.incomeTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Zahlungseingänge gesamt</td><td>${formatCurrency(data.kpis.paymentReceivedTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Betriebsausgaben</td><td>${formatCurrency(data.kpis.expensesTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Kundenbeteiligung an Ausgaben</td><td>${formatCurrency(data.kpis.clientShareTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Effektive Ausgaben</td><td>${formatCurrency(data.kpis.effectiveExpensesTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Bank- & Wechselgebühren</td><td>${formatCurrency(data.kpis.feeTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Fahrtkosten</td><td>${formatCurrency(data.kpis.tripDrivingTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Reisekosten / Verpflegungspauschalen</td><td>${formatCurrency(data.kpis.tripTravelTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Abschreibungen</td><td>${formatCurrency(data.kpis.depreciationTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Nicht erstattete Kosten</td><td>${formatCurrency(data.kpis.unreimbursedCosts, data.reportingCurrency)}</td></tr>
          <tr><td>Steuerlich relevante Summe</td><td>${formatCurrency(data.kpis.deductibleCostTotal, data.reportingCurrency)}</td></tr>
          <tr><td>Gewinn</td><td>${formatCurrency(data.kpis.taxRelevantProfit, data.reportingCurrency)}</td></tr>
          <tr><td>Offene Einnahmen</td><td>${formatCurrency(data.kpis.openIncomeTotal, data.reportingCurrency)}</td></tr>
        </table>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
