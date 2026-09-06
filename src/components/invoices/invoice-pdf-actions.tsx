"use client";

import { Download, Eye, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { createInvoicePdfFilename } from "@/lib/invoice-pdf";

export function InvoicePdfActions({
  invoiceId,
  invoiceNumber,
  recipientName
}: {
  invoiceId: string;
  invoiceNumber: string | null;
  recipientName: string;
}) {
  const [downloading, setDownloading] = useState(false);
  const [message, setMessage] = useState<{
    type: "error" | "warning";
    text: string;
  } | null>(null);
  const pdfUrl = `/api/invoices/${encodeURIComponent(invoiceId)}/pdf`;

  function previewPdf() {
    window.open(pdfUrl, "_blank", "noopener,noreferrer");
  }

  async function downloadPdf() {
    setDownloading(true);
    setMessage(null);

    try {
      const response = await fetch(`${pdfUrl}?download=1`, {
        credentials: "same-origin",
        headers: { Accept: "application/pdf" }
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "PDF konnte nicht erstellt werden.");
      }

      if (!response.headers.get("Content-Type")?.includes("application/pdf")) {
        throw new Error("Der Download konnte nicht gestartet werden.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = createInvoicePdfFilename(invoiceNumber, recipientName);
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);

      if (response.headers.get("X-Invoice-Pdf-Warning") === "qr-unavailable") {
        setMessage({
          type: "warning",
          text: "PDF wurde ohne QR-Code erstellt. Die Bankdaten sind weiterhin enthalten."
        });
      }
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "PDF konnte nicht erstellt werden."
      });
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" onClick={previewPdf}>
        <Eye aria-hidden="true" className="mr-2 h-4 w-4" />
        PDF ansehen
      </Button>
      <Button type="button" variant="ghost" disabled={downloading} onClick={downloadPdf}>
        {downloading ? (
          <LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
        )}
        {downloading ? "PDF wird erstellt…" : "PDF herunterladen"}
      </Button>
      {message ? (
        <span
          aria-live="polite"
          className={message.type === "error" ? "basis-full text-xs text-rose-700" : "basis-full text-xs text-amber-700"}
          role={message.type === "error" ? "alert" : "status"}
        >
          {message.text}
        </span>
      ) : null}
    </>
  );
}
