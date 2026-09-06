import { NextResponse } from "next/server";
import {
  getInvoicePdfReactRuntimeInfo,
  renderInvoicePdfWithOptionalQrFallback
} from "@/components/invoices/invoice-pdf-document";
import {
  createInvoiceAssetDataUrl,
  getInvoiceForView,
  getInvoicePaymentFallback,
  InvoiceAccessError
} from "@/lib/invoice-data";
import {
  createInvoicePdfFilename,
  createPdfContentDisposition,
  hasStoredInvoiceSnapshot,
  resolveInvoiceBankSnapshot
} from "@/lib/invoice-pdf";
import { generatePaymentQr } from "@/lib/payment-qr";

export const runtime = "nodejs";

type SafeErrorDetails = {
  name: string;
  message: string;
  stack?: string;
  cause?: SafeErrorDetails;
};

function safeErrorDetails(error: unknown, depth = 0): SafeErrorDetails {
  if (!(error instanceof Error)) {
    return {
      name: "NonErrorThrownValue",
      message: `A non-Error value of type ${typeof error} was thrown.`
    };
  }

  const details: SafeErrorDetails = {
    name: error.name,
    message: error.message,
    stack: error.stack
  };
  if (error.cause !== undefined && depth < 2) {
    details.cause = safeErrorDetails(error.cause, depth + 1);
  }
  return details;
}

function value(snapshot: Record<string, unknown> | null | undefined, key: string) {
  return typeof snapshot?.[key] === "string" ? String(snapshot[key]) : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  let invoiceId = "unresolved";
  let stage = "request-started";

  try {
    const { id } = await params;
    invoiceId = id;
    if (!isUuid(id)) {
      return NextResponse.json({ error: "Rechnung wurde nicht gefunden." }, { status: 404 });
    }

    stage = "invoice-loading";
    const loadedInvoice = await getInvoiceForView(id);
    if (!loadedInvoice) {
      return NextResponse.json({ error: "Rechnung wurde nicht gefunden." }, { status: 404 });
    }
    const { invoice, access } = loadedInvoice;
    console.info("[invoice-pdf] invoice loaded", {
      invoiceId,
      currency: invoice.currency,
      itemCount: invoice.items?.length ?? 0
    });

    stage = "payment-data-preparing";
    const customer = invoice.customer_snapshot as Record<string, unknown>;
    const sender = invoice.sender_snapshot as Record<string, unknown>;
    const snapshotBank = invoice.bank_snapshot as Record<string, unknown> | null;
    const hasBankSnapshot = hasStoredInvoiceSnapshot(snapshotBank);
    // Older invoices without a bank snapshot intentionally retain the existing
    // compatibility fallback, scoped to this invoice's Buchhaltung.
    const paymentFallback = hasBankSnapshot
      ? null
      : await getInvoicePaymentFallback(invoice, access);
    const bank = resolveInvoiceBankSnapshot(
      snapshotBank,
      paymentFallback?.bank as Record<string, unknown> | null | undefined
    );
    const qrSnapshot = (invoice.qr_payment_snapshot ?? {}) as Record<string, unknown>;
    const fallbackQrMode = paymentFallback?.invoiceSettings?.default_use_uploaded_qr
      && value(bank, "qr_storage_path")
      ? "uploaded"
      : paymentFallback?.invoiceSettings?.default_payment_qr_enabled
          && invoice.currency === "EUR"
        ? "generated"
        : "none";
    const qrMode = ["uploaded", "generated", "none"].includes(String(qrSnapshot.mode))
      ? String(qrSnapshot.mode)
      : fallbackQrMode;
    const uploadedQrPath = typeof qrSnapshot.uploaded_qr_storage_path === "string"
      ? qrSnapshot.uploaded_qr_storage_path
      : value(bank, "qr_storage_path");

    let paymentQrImage: string | null = null;
    let paymentQrLabel: string | null = null;
    let qrUnavailable = false;

    try {
      stage = "qr-preparing";
      if (qrMode === "uploaded" && uploadedQrPath) {
        paymentQrImage = await createInvoiceAssetDataUrl(
          uploadedQrPath,
          invoice.buchhaltung_id,
          access
        );
        paymentQrLabel = "Zahlungs-QR-Code";
        qrUnavailable = !paymentQrImage;
      } else if (qrMode === "generated") {
        const generatedQr = await generatePaymentQr({
          accountHolder: value(bank, "account_holder"),
          iban: value(bank, "iban"),
          bic: value(bank, "bic"),
          amountCents: invoice.gross_total_cents,
          currency: invoice.currency,
          invoiceNumber: invoice.invoice_number,
          purpose: typeof qrSnapshot.payment_purpose === "string"
            ? qrSnapshot.payment_purpose
            : null
        });
        paymentQrImage = generatedQr?.dataUrl ?? null;
        paymentQrLabel = generatedQr?.label ?? null;
        qrUnavailable = !paymentQrImage;
      }
    } catch (error) {
      qrUnavailable = qrMode !== "none";
      console.warn("[invoice-pdf] QR preparation failed", {
        invoiceId,
        qrMode,
        ...safeErrorDetails(error)
      });
    }
    console.info("[invoice-pdf] QR prepared", {
      invoiceId,
      qrMode,
      included: Boolean(paymentQrImage),
      unavailable: qrUnavailable
    });

    stage = "renderer-starting";
    const renderResult = await renderInvoicePdfWithOptionalQrFallback(
      {
        invoice,
        customer,
        sender,
        bank,
        qrImage: paymentQrImage,
        qrLabel: paymentQrLabel
      },
      {
        onAttemptStarting(attempt, hasQrImage) {
          stage = attempt === "primary"
            ? "renderer-primary-starting"
            : "renderer-without-optional-qr-starting";
          console.info("[invoice-pdf] renderer starting", {
            invoiceId,
            attempt,
            hasQrImage,
            reactRuntime: getInvoicePdfReactRuntimeInfo()
          });
        },
        onRenderStage(renderStage, attempt, details) {
          stage = `${attempt}:${renderStage}`;
          console.info(`[invoice-pdf] ${renderStage}`, {
            invoiceId,
            attempt,
            ...details
          });
        },
        onOptionalQrError(error) {
          qrUnavailable = true;
          console.warn("[invoice-pdf] optional QR render failed; retrying without QR", {
            invoiceId,
            ...safeErrorDetails(error)
          });
        }
      }
    );
    const pdfBuffer = renderResult.buffer;
    qrUnavailable ||= renderResult.qrOmitted;

    stage = "response-building";
    const filename = createInvoicePdfFilename(
      invoice.invoice_number,
      value(customer, "company_name")
    );
    const shouldDownload = new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": createPdfContentDisposition(
        filename,
        shouldDownload ? "attachment" : "inline"
      ),
      "Content-Length": String(pdfBuffer.byteLength),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff"
    };
    if (qrUnavailable) headers["X-Invoice-Pdf-Warning"] = "qr-unavailable";

    const response = new NextResponse(new Uint8Array(pdfBuffer), { headers });
    console.info("[invoice-pdf] response ready", {
      invoiceId,
      byteLength: pdfBuffer.byteLength,
      disposition: shouldDownload ? "attachment" : "inline",
      qrOmitted: renderResult.qrOmitted
    });
    return response;
  } catch (error) {
    if (error instanceof InvoiceAccessError && error.code === "UNAUTHENTICATED") {
      return NextResponse.json(
        { error: "Bitte melden Sie sich an, um die Rechnung abzurufen." },
        { status: 401 }
      );
    }
    if (error instanceof InvoiceAccessError && error.code === "LOAD_FAILED") {
      return NextResponse.json(
        { error: "Die Rechnungsdaten konnten nicht geladen werden." },
        { status: 500 }
      );
    }

    console.error("[invoice-pdf] generation failed", {
      invoiceId,
      stage,
      runtime: "nodejs",
      nodeVersion: process.version,
      ...safeErrorDetails(error)
    });
    return NextResponse.json(
      { error: "PDF konnte nicht erstellt werden." },
      { status: 500 }
    );
  }
}
