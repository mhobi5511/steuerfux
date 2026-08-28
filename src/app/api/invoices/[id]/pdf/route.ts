import { NextResponse } from "next/server";
import { createInvoiceAssetSignedUrl, getInvoiceForView } from "@/lib/invoice-data";
import { formatCents } from "@/lib/invoice-utils";
import { generatePaymentQr } from "@/lib/payment-qr";
import { formatDate } from "@/lib/utils";

function value(snapshot: Record<string, unknown> | null | undefined, key: string) {
  return typeof snapshot?.[key] === "string" ? String(snapshot[key]) : "";
}

function escapeHtml(input: string) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const invoice = await getInvoiceForView(params.id);
  if (!invoice) {
    return NextResponse.json({ error: "Rechnung wurde nicht gefunden." }, { status: 404 });
  }

  const customer = invoice.customer_snapshot as Record<string, unknown>;
  const sender = invoice.sender_snapshot as Record<string, unknown>;
  const bank = (invoice.bank_snapshot ?? {}) as Record<string, unknown>;
  const qrSnapshot = (invoice.qr_payment_snapshot ?? {}) as Record<string, unknown>;
  const items = (invoice.items ?? []).sort((a, b) => a.sort_order - b.sort_order);
  const uploadedQrPath = typeof qrSnapshot.uploaded_qr_storage_path === "string"
    ? qrSnapshot.uploaded_qr_storage_path
    : value(bank, "qr_storage_path");
  const uploadedQrUrl = qrSnapshot.mode === "uploaded" && uploadedQrPath
    ? await createInvoiceAssetSignedUrl(uploadedQrPath)
    : null;
  const generatedQr = qrSnapshot.mode === "generated"
    ? await generatePaymentQr({
        accountHolder: value(bank, "account_holder"),
        iban: value(bank, "iban"),
        bic: value(bank, "bic"),
        amountCents: invoice.gross_total_cents,
        currency: invoice.currency,
        invoiceNumber: invoice.invoice_number,
        purpose: typeof qrSnapshot.payment_purpose === "string" ? qrSnapshot.payment_purpose : null
      })
    : null;
  const paymentQrImage = uploadedQrUrl ?? generatedQr?.dataUrl ?? null;
  const paymentQrLabel = uploadedQrUrl
    ? "Zahlungs-QR-Code"
    : generatedQr?.label ?? null;
  const isTaxExempt = invoice.kleinunternehmer || (invoice.vat_total_cents === 0 && Boolean(invoice.tax_note));

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Rechnung ${escapeHtml(invoice.invoice_number ?? "Entwurf")}</title>
  <style>
    @page { size: A4; margin: 18mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: #0f172a;
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 12px;
      line-height: 1.5;
    }
    .page { max-width: 900px; margin: 0 auto; padding: 34px; }
    .top { display: flex; justify-content: space-between; gap: 40px; align-items: flex-start; }
    h1 { margin: 0; font-size: 38px; letter-spacing: 0; }
    .muted { color: #64748b; }
    .meta { min-width: 230px; border-left: 3px solid #0f172a; padding-left: 16px; }
    .meta div { display: flex; justify-content: space-between; gap: 16px; padding: 3px 0; }
    .addresses { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 46px; }
    .address-card { display: flex; flex-direction: column; }
    .label { margin-bottom: 10px; font-size: 11px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; }
    .box { flex: 1; border: 1px solid #dbe3ef; border-radius: 16px; padding: 16px; min-height: 150px; }
    .due { margin: 34px 0; border-radius: 18px; background: #0f172a; color: #fff; padding: 20px 24px; }
    .due strong { display: block; margin-top: 4px; font-size: 25px; }
    table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th { text-align: left; padding: 11px 10px; background: #f1f5f9; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
    td { vertical-align: top; padding: 13px 10px; border-bottom: 1px solid #e2e8f0; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .item-title { font-weight: 700; color: #0f172a; }
    .totals { width: min(390px, 100%); margin-left: auto; margin-top: 24px; }
    .totals div { display: flex; justify-content: space-between; gap: 20px; padding: 8px 0; border-bottom: 1px solid #e2e8f0; }
    .totals .grand { font-size: 16px; font-weight: 800; border-bottom: 0; }
    .payment { margin-top: 34px; display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
    .qr { margin-top: 18px; }
    .qr img { display: block; width: 132px; height: 132px; object-fit: contain; image-rendering: crisp-edges; }
    .qr-label { margin: 8px 0 0; font-size: 10px; color: #64748b; }
    .notice { margin-top: -18px; margin-bottom: 24px; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; border-radius: 14px; padding: 12px 14px; }
    .footer { margin-top: 34px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px; }
    @media print { .page { padding: 0; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <main class="page">
    <section class="top">
      <div>
        <h1>RECHNUNG</h1>
      </div>
      <aside class="meta">
        <div><span class="muted">Rechnungsnummer</span><strong>${escapeHtml(invoice.invoice_number ?? "Entwurf")}</strong></div>
        <div><span class="muted">Ausstellungsdatum</span><strong>${formatDate(invoice.issue_date)}</strong></div>
        <div><span class="muted">Status</span><strong>${escapeHtml(invoice.status)}</strong></div>
      </aside>
    </section>

    <section class="addresses">
      <div class="address-card">
        <p class="label">Rechnung für</p>
        <div class="box">
          <strong>${escapeHtml(value(customer, "company_name"))}</strong><br />
          ${value(customer, "contact_name") ? `${escapeHtml(value(customer, "contact_name"))}<br />` : ""}
          ${escapeHtml(value(customer, "street"))}<br />
          ${escapeHtml(value(customer, "postal_code"))} ${escapeHtml(value(customer, "city"))}<br />
          ${escapeHtml(value(customer, "country"))}<br /><br />
          ${escapeHtml(value(customer, "email"))}
        </div>
      </div>
      <div class="address-card">
        <p class="label">Ausgestellt von</p>
        <div class="box">
          <strong>${escapeHtml(value(sender, "name"))}</strong><br />
          ${value(sender, "addition") ? `${escapeHtml(value(sender, "addition"))}<br />` : ""}
          ${escapeHtml(value(sender, "street"))}<br />
          ${escapeHtml(value(sender, "postal_code"))} ${escapeHtml(value(sender, "city"))}<br />
          ${escapeHtml(value(sender, "country"))}<br /><br />
          ${escapeHtml(value(sender, "email"))}<br />
          ${value(sender, "phone") ? `${escapeHtml(value(sender, "phone"))}<br />` : ""}
          ${value(sender, "tax_id") ? `Steuernummer / UID: ${escapeHtml(value(sender, "tax_id"))}` : ""}
        </div>
      </div>
    </section>

    <section class="due">
      <span>Zu zahlender Betrag</span>
      <strong>${formatCents(invoice.gross_total_cents, invoice.currency)} fällig bis zum ${formatDate(invoice.due_date)}</strong>
    </section>
    ${invoice.tax_note ? `<div class="notice">${escapeHtml(invoice.tax_note)}</div>` : ""}

    <table>
      <thead>
        <tr>
          <th>Produkt oder Dienstleistung</th>
          <th class="num">Menge</th>
          <th class="num">Einzelpreis</th>
          <th class="num">Steuern</th>
          <th class="num">Gesamtbetrag</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map(
            (item) => `<tr>
              <td><div class="item-title">${escapeHtml(item.title)}</div>${item.description ? `<div class="muted">${escapeHtml(item.description)}</div>` : ""}</td>
              <td class="num">${Number(item.quantity).toLocaleString("de-DE")} ${escapeHtml(item.unit ?? "")}</td>
              <td class="num">${formatCents(item.unit_price_cents, invoice.currency)}</td>
              <td class="num">${isTaxExempt ? formatCents(0, invoice.currency) : `${Number(item.vat_rate).toLocaleString("de-DE")} %<br /><span class="muted">${formatCents(item.vat_amount_cents, invoice.currency)}</span>`}</td>
              <td class="num">${formatCents(item.gross_amount_cents, invoice.currency)}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>

    <section class="totals">
      <div><span>Gesamtsumme ohne Steuern</span><strong>${formatCents(invoice.net_total_cents, invoice.currency)}</strong></div>
      <div><span>Gesamtsteuer</span><strong>${formatCents(invoice.vat_total_cents, invoice.currency)}</strong></div>
      <div class="grand"><span>Zu zahlender Betrag</span><strong>${formatCents(invoice.gross_total_cents, invoice.currency)}</strong></div>
    </section>

    <section class="payment">
      <div>
        <p class="label">Zahlungsmöglichkeiten</p>
        <p>Bitte überweisen Sie den Betrag bis zum Fälligkeitsdatum.</p>
        ${paymentQrImage ? `<div class="qr"><img src="${escapeHtml(paymentQrImage)}" alt="${escapeHtml(paymentQrLabel ?? "Zahlungs-QR-Code")}" /><p class="qr-label">${escapeHtml(paymentQrLabel ?? "Zahlungs-QR-Code")}</p></div>` : ""}
      </div>
      <div>
        <p class="label">Bankverbindung</p>
        ${value(bank, "account_holder") ? `<strong>${escapeHtml(value(bank, "account_holder"))}</strong><br />` : ""}
        ${value(bank, "iban") ? `IBAN: ${escapeHtml(value(bank, "iban"))}<br />` : ""}
        ${value(bank, "bic") ? `BIC / SWIFT: ${escapeHtml(value(bank, "bic"))}<br />` : ""}
        ${value(bank, "bank_name") ? `${escapeHtml(value(bank, "bank_name"))}<br />` : ""}
      </div>
    </section>
  </main>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="rechnung-${invoice.invoice_number ?? invoice.id}.html"`
    }
  });
}
