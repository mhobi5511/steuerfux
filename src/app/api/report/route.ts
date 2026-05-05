import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";
import { formatCurrency } from "@/lib/utils";

function formatReportDate(value = new Date()) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(value);
}

function metricRow(label: string, value: string, emphasis = false) {
  return `
    <tr class="${emphasis ? "emphasis" : ""}">
      <td>${label}</td>
      <td>${value}</td>
    </tr>
  `;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year") ?? new Date().getFullYear());
  const data = await getDashboardData(year);
  const ownerName = data.settings?.business_owner_name || "Buchhaltung";
  const travelTotal = data.kpis.tripDrivingTotal + data.kpis.tripTravelTotal;

  const html = `
    <!doctype html>
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Jahresreport ${year}</title>
        <style>
          @page {
            size: A4;
            margin: 18mm;
          }

          :root {
            --ink: #0f172a;
            --muted: #64748b;
            --line: #dbe3ef;
            --soft: #f1f5f9;
            --panel: #f8fafc;
            --accent: #14532d;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: #ffffff;
            color: var(--ink);
            font-family:
              ui-sans-serif,
              -apple-system,
              BlinkMacSystemFont,
              "Segoe UI",
              sans-serif;
            font-size: 13px;
            line-height: 1.45;
          }

          .page {
            max-width: 980px;
            margin: 0 auto;
            padding: 32px;
          }

          .hero {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 24px;
            align-items: end;
            border-bottom: 2px solid var(--ink);
            padding-bottom: 22px;
            margin-bottom: 24px;
          }

          .eyebrow {
            margin: 0 0 8px;
            color: var(--muted);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          h1 {
            margin: 0;
            font-size: 34px;
            line-height: 1.05;
            letter-spacing: -0.02em;
          }

          h2 {
            margin: 0 0 12px;
            font-size: 16px;
          }

          .meta {
            min-width: 220px;
            border: 1px solid var(--line);
            background: var(--panel);
            border-radius: 14px;
            padding: 14px;
          }

          .meta div {
            display: flex;
            justify-content: space-between;
            gap: 18px;
            padding: 5px 0;
          }

          .meta span:first-child,
          .label {
            color: var(--muted);
          }

          .summary {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin: 24px 0;
          }

          .tile {
            border: 1px solid var(--line);
            border-radius: 14px;
            background: var(--soft);
            padding: 14px;
            min-height: 94px;
          }

          .tile strong {
            display: block;
            margin-top: 8px;
            font-size: 20px;
            line-height: 1.15;
          }

          .tile.primary {
            background: #ecfdf3;
            border-color: #bbf7d0;
          }

          .tile.primary strong {
            color: var(--accent);
          }

          .section {
            margin-top: 26px;
          }

          table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            overflow: hidden;
            border: 1px solid var(--line);
            border-radius: 14px;
          }

          th,
          td {
            padding: 10px 12px;
            text-align: left;
            border-bottom: 1px solid var(--line);
          }

          th {
            background: var(--ink);
            color: #ffffff;
            font-size: 11px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          tr:last-child td {
            border-bottom: 0;
          }

          td:last-child,
          th:last-child {
            text-align: right;
            white-space: nowrap;
          }

          tr.emphasis td {
            background: #f8fafc;
            font-weight: 700;
          }

          .two-column {
            display: grid;
            grid-template-columns: 1.08fr 0.92fr;
            gap: 18px;
            align-items: start;
          }

          .footer {
            margin-top: 28px;
            padding-top: 14px;
            border-top: 1px solid var(--line);
            color: var(--muted);
            font-size: 11px;
          }

          @media print {
            body {
              print-color-adjust: exact;
              -webkit-print-color-adjust: exact;
            }

            .page {
              padding: 0;
            }

            .section,
            table,
            .summary {
              break-inside: avoid;
            }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <header class="hero">
            <div>
              <p class="eyebrow">Jahresabschluss</p>
              <h1>Jahresreport ${year}</h1>
            </div>
            <aside class="meta">
              <div><span>Name</span><strong>${ownerName}</strong></div>
              <div><span>Währung</span><strong>${data.reportingCurrency}</strong></div>
              <div><span>Erstellt</span><strong>${formatReportDate()}</strong></div>
            </aside>
          </header>

          <section class="summary">
            <div class="tile primary">
              <span class="label">Umsatz</span>
              <strong>${formatCurrency(data.kpis.paymentReceivedTotal, data.reportingCurrency)}</strong>
            </div>
            <div class="tile">
              <span class="label">Steuerlich relevante Kosten</span>
              <strong>${formatCurrency(data.kpis.deductibleCostTotal, data.reportingCurrency)}</strong>
            </div>
            <div class="tile primary">
              <span class="label">Steuerlich relevanter Betrag</span>
              <strong>${formatCurrency(data.kpis.taxRelevantProfit, data.reportingCurrency)}</strong>
            </div>
          </section>

          <section class="section two-column">
            <div>
              <h2>Zusammenfassung</h2>
              <table>
                <thead>
                  <tr><th>Position</th><th>Wert</th></tr>
                </thead>
                <tbody>
                  ${metricRow("Rechnungssumme", formatCurrency(data.kpis.incomeTotal, data.reportingCurrency))}
                  ${metricRow("Umsatz", formatCurrency(data.kpis.paymentReceivedTotal, data.reportingCurrency), true)}
                  ${metricRow("Offene Einnahmen", formatCurrency(data.kpis.openIncomeTotal, data.reportingCurrency))}
                  ${metricRow("Gebühren", formatCurrency(data.kpis.feeTotal, data.reportingCurrency))}
                  ${metricRow("Fahrt-, Reise- und Verpflegungskosten", formatCurrency(travelTotal, data.reportingCurrency))}
                  ${metricRow("Ausgaben", formatCurrency(data.kpis.deductibleExpensesTotal + data.kpis.depreciationTotal, data.reportingCurrency))}
                  ${metricRow("Steuerlich relevante Kosten", formatCurrency(data.kpis.deductibleCostTotal, data.reportingCurrency), true)}
                  ${metricRow("Steuerlich relevanter Betrag", formatCurrency(data.kpis.taxRelevantProfit, data.reportingCurrency), true)}
                </tbody>
              </table>
            </div>

            <div>
              <h2>Kostenaufschlüsselung</h2>
              <table>
                <thead>
                  <tr><th>Kategorie</th><th>Wert</th></tr>
                </thead>
                <tbody>
                  ${metricRow("Ausgaben", formatCurrency(data.kpis.deductibleExpensesTotal, data.reportingCurrency))}
                  ${metricRow("Bank- & Wechselgebühren", formatCurrency(data.kpis.feeTotal, data.reportingCurrency))}
                  ${metricRow("Fahrtkosten", formatCurrency(data.kpis.tripDrivingTotal, data.reportingCurrency))}
                  ${metricRow("Reise & Verpflegung", formatCurrency(data.kpis.tripTravelTotal, data.reportingCurrency))}
                  ${metricRow("Abschreibungen", formatCurrency(data.kpis.depreciationTotal, data.reportingCurrency))}
                </tbody>
              </table>
            </div>
          </section>

          <section class="section">
            <h2>Monatsübersicht</h2>
            <table>
              <thead>
                <tr>
                  <th>Monat</th>
                  <th>Umsatz</th>
                  <th>Kundenbeteiligung</th>
                  <th>Kosten</th>
                  <th>Resultat</th>
                </tr>
              </thead>
              <tbody>
                ${data.monthly
                  .map(
                    (row) => `
                      <tr>
                        <td>${row.month}</td>
                        <td>${formatCurrency(row.incomes, data.reportingCurrency)}</td>
                        <td>${formatCurrency(row.clientShare, data.reportingCurrency)}</td>
                        <td>${formatCurrency(row.costs, data.reportingCurrency)}</td>
                        <td>${formatCurrency(row.result, data.reportingCurrency)}</td>
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
          </section>

          <p class="footer">
            Dieser Report ist eine druckbare Übersicht aus den erfassten Buchhaltungsdaten.
            Die fachliche Prüfung erfolgt bei Bedarf separat.
          </p>
        </main>
      </body>
    </html>
  `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8"
    }
  });
}
