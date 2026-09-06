/** @jsxRuntime classic */
/** @jsx createPdfElement */

import * as nodeModule from "node:module";
import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer
} from "@react-pdf/renderer";
import type { ReactNode } from "react";
import type { Invoice, InvoiceItem } from "@/lib/db-types";
import { formatCents } from "@/lib/invoice-utils";
import { formatDate } from "@/lib/utils";

// Next.js App Router compiles ordinary server JSX with its vendored RSC React
// runtime. React-PDF is a server external and must receive elements created by
// the application's matching React dependency instead.
const createNodeRequire = Reflect.get(
  nodeModule,
  "createRequire"
) as typeof nodeModule.createRequire;
const requireFromApplication = Reflect.apply(createNodeRequire, nodeModule, [
  `${process.cwd()}/package.json`
]);
const applicationReact = requireFromApplication("react") as typeof import("react");
const { createElement: createPdfElement } = applicationReact;

export function getInvoicePdfReactRuntimeInfo() {
  const probe = createPdfElement("invoice-pdf-runtime-probe") as unknown as {
    $$typeof: symbol;
  };
  const reactMajor = Number.parseInt(applicationReact.version.split(".")[0] ?? "", 10);
  const expectedElementType = reactMajor >= 19
    ? Symbol.for("react.transitional.element")
    : Symbol.for("react.element");

  return {
    reactVersion: applicationReact.version,
    elementType: String(probe.$$typeof),
    compatible: probe.$$typeof === expectedElementType
  };
}

function assertCompatiblePdfReactRuntime() {
  const runtime = getInvoicePdfReactRuntimeInfo();
  if (!runtime.compatible) {
    throw new Error(
      `PDF React element factory is incompatible with React ${runtime.reactVersion}: ${runtime.elementType}`
    );
  }
}

type Snapshot = Record<string, unknown>;

type Props = {
  invoice: Invoice;
  customer: Snapshot;
  sender: Snapshot;
  bank: Snapshot;
  qrImage: string | null;
  qrLabel: string | null;
};

type RenderAttempt = "primary" | "without-optional-qr";

type RenderDiagnostics = {
  onAttemptStarting?: (attempt: RenderAttempt, hasQrImage: boolean) => void;
  onRenderStage?: (
    stage: "renderToBuffer starting" | "renderToBuffer completed",
    attempt: RenderAttempt,
    details?: { byteLength: number }
  ) => void;
  onOptionalQrError?: (error: unknown) => void;
};

export type InvoicePdfRenderResult = {
  buffer: Awaited<ReturnType<typeof renderToBuffer>>;
  qrOmitted: boolean;
};

const styles = StyleSheet.create({
  page: { paddingTop: 48, paddingHorizontal: 48, paddingBottom: 68, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },
  top: { flexDirection: "row", justifyContent: "space-between", flexShrink: 0 },
  title: { fontSize: 28, fontFamily: "Helvetica-Bold" },
  meta: { width: 190, borderLeftWidth: 2, borderLeftColor: "#0f172a", paddingLeft: 12 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  muted: { color: "#64748b" },
  addresses: { flexDirection: "row", gap: 20, marginTop: 30, flexShrink: 0 },
  address: { flexGrow: 1, flexBasis: 0 },
  label: { marginBottom: 7, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b" },
  box: { minHeight: 105, borderWidth: 1, borderColor: "#dbe3ef", borderRadius: 10, padding: 12 },
  due: { marginTop: 24, backgroundColor: "#0f172a", color: "#ffffff", borderRadius: 10, padding: 16, flexShrink: 0 },
  dueAmount: { marginTop: 4, fontSize: 18, fontFamily: "Helvetica-Bold" },
  notice: { marginTop: 16, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", color: "#92400e", borderRadius: 8, padding: 10, flexShrink: 0 },
  table: { marginTop: 24, flexShrink: 0 },
  tableHead: { flexDirection: "row", backgroundColor: "#f1f5f9", paddingVertical: 8 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 9 },
  description: { width: "40%" },
  quantity: { width: "12%", textAlign: "right" },
  money: { width: "16%", textAlign: "right" },
  totals: { width: 270, marginLeft: "auto", marginTop: 18 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingVertical: 6 },
  grand: { fontFamily: "Helvetica-Bold", fontSize: 12, borderBottomWidth: 0 },
  payment: { flexDirection: "row", gap: 26, marginTop: 26 },
  paymentColumn: { flexGrow: 1, flexBasis: 0 },
  qr: { width: 112, height: 112, marginTop: 10 },
  qrLabel: { marginTop: 5, fontSize: 8, color: "#64748b" },
  continuationHeader: { position: "absolute", left: 48, right: 48, top: 24, color: "#64748b", fontSize: 8, textAlign: "right" },
  footer: { position: "absolute", left: 48, right: 48, bottom: 24, borderTopWidth: 1, borderTopColor: "#e2e8f0", paddingTop: 6, flexDirection: "row", justifyContent: "space-between" },
  footerText: { color: "#64748b", fontSize: 8 }
});

function value(snapshot: Snapshot, key: string) {
  return typeof snapshot[key] === "string" ? String(snapshot[key]) : "";
}

function lines(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join("\n");
}

function assertValidPdfBuffer(buffer: Uint8Array) {
  const hasPdfSignature = buffer.byteLength >= 5
    && buffer[0] === 0x25
    && buffer[1] === 0x50
    && buffer[2] === 0x44
    && buffer[3] === 0x46
    && buffer[4] === 0x2d;
  if (!hasPdfSignature) {
    throw new Error("The invoice renderer returned an invalid PDF buffer.");
  }
}

export async function renderMinimalPdf() {
  assertCompatiblePdfReactRuntime();
  const document = <Document><Page><Text>Hello PDF</Text></Page></Document>;
  const buffer = await renderToBuffer(document);
  assertValidPdfBuffer(buffer);
  return buffer;
}

function AddressBox({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.address}><Text style={styles.label}>{title}</Text><View style={styles.box}>{children}</View></View>;
}

function ItemRow({ item, invoice, isTaxExempt }: { item: InvoiceItem; invoice: Invoice; isTaxExempt: boolean }) {
  return <View style={styles.row} wrap={false}>
    <View style={styles.description}><Text style={{ fontFamily: "Helvetica-Bold" }}>{item.title}</Text>{item.description ? <Text style={styles.muted}>{item.description}</Text> : null}</View>
    <Text style={styles.quantity}>{Number(item.quantity).toLocaleString("de-DE")} {item.unit ?? ""}</Text>
    <Text style={styles.money}>{formatCents(item.unit_price_cents, invoice.currency)}</Text>
    <Text style={styles.money}>{isTaxExempt ? formatCents(0, invoice.currency) : `${Number(item.vat_rate).toLocaleString("de-DE")} %\n${formatCents(item.vat_amount_cents, invoice.currency)}`}</Text>
    <Text style={styles.money}>{formatCents(item.gross_amount_cents, invoice.currency)}</Text>
  </View>;
}

export async function renderInvoicePdf(
  props: Props,
  diagnostics: RenderDiagnostics = {},
  attempt: RenderAttempt = "primary"
) {
  assertCompatiblePdfReactRuntime();
  const { invoice, customer, sender, bank, qrImage, qrLabel } = props;
  const items = [...(invoice.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const isTaxExempt = invoice.kleinunternehmer || (invoice.vat_total_cents === 0 && Boolean(invoice.tax_note));
  const document = (
    <Document title={`Rechnung ${invoice.invoice_number ?? "Entwurf"}`} author={value(sender, "name")}>
      <Page size="A4" style={styles.page}>
        <Text
          style={styles.continuationHeader}
          fixed
          render={({ pageNumber }) => pageNumber > 1
            ? `Rechnung ${invoice.invoice_number ?? "Entwurf"} · Fortsetzung`
            : ""}
        />
        <View style={styles.top} wrap={false}>
          <Text style={styles.title}>RECHNUNG</Text>
          <View style={styles.meta}>
            <View style={styles.metaRow}><Text style={styles.muted}>Rechnungsnummer</Text><Text>{invoice.invoice_number ?? "Entwurf"}</Text></View>
            <View style={styles.metaRow}><Text style={styles.muted}>Ausstellungsdatum</Text><Text>{formatDate(invoice.issue_date)}</Text></View>
            <View style={styles.metaRow}><Text style={styles.muted}>Status</Text><Text>{invoice.status}</Text></View>
          </View>
        </View>
        <View style={styles.addresses} wrap={false}>
          <AddressBox title="RECHNUNG FÜR"><Text>{lines([value(customer, "company_name"), value(customer, "contact_name"), value(customer, "street"), `${value(customer, "postal_code")} ${value(customer, "city")}`.trim(), value(customer, "country"), "", value(customer, "email")])}</Text></AddressBox>
          <AddressBox title="AUSGESTELLT VON"><Text>{lines([value(sender, "name"), value(sender, "addition"), value(sender, "street"), `${value(sender, "postal_code")} ${value(sender, "city")}`.trim(), value(sender, "country"), "", value(sender, "email"), value(sender, "phone"), value(sender, "tax_id") ? `Steuernummer / UID: ${value(sender, "tax_id")}` : ""])}</Text></AddressBox>
        </View>
        <View style={styles.due} wrap={false}><Text>Zu zahlender Betrag</Text><Text style={styles.dueAmount}>{formatCents(invoice.gross_total_cents, invoice.currency)} fällig bis zum {formatDate(invoice.due_date)}</Text></View>
        {invoice.tax_note ? <View style={styles.notice} wrap={false}><Text>{invoice.tax_note}</Text></View> : null}
        <View style={styles.table}>
          <View style={styles.tableHead} wrap={false}><Text style={styles.description}>Produkt oder Dienstleistung</Text><Text style={styles.quantity}>Menge</Text><Text style={styles.money}>Einzelpreis</Text><Text style={styles.money}>Steuern</Text><Text style={styles.money}>Gesamtbetrag</Text></View>
          {items.map((item) => <ItemRow key={item.id} item={item} invoice={invoice} isTaxExempt={isTaxExempt} />)}
        </View>
        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}><Text>Gesamtsumme ohne Steuern</Text><Text>{formatCents(invoice.net_total_cents, invoice.currency)}</Text></View>
          <View style={styles.totalRow}><Text>Gesamtsteuer</Text><Text>{formatCents(invoice.vat_total_cents, invoice.currency)}</Text></View>
          <View style={[styles.totalRow, styles.grand]}><Text>Zu zahlender Betrag</Text><Text>{formatCents(invoice.gross_total_cents, invoice.currency)}</Text></View>
        </View>
        <View style={styles.payment} wrap={false}>
          <View style={styles.paymentColumn}>
            <Text style={styles.label}>ZAHLUNGSMÖGLICHKEITEN</Text>
            <Text>Bitte überweisen Sie den Betrag bis zum Fälligkeitsdatum.</Text>
            {qrImage ? <View>
              {/* @react-pdf/renderer Image has no HTML alt prop. The visible label follows it. */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <Image style={styles.qr} src={qrImage} />
              <Text style={styles.qrLabel}>{qrLabel ?? "Zahlungs-QR-Code"}</Text>
            </View> : null}
          </View>
          <View style={styles.paymentColumn}><Text style={styles.label}>BANKVERBINDUNG</Text><Text>{lines([value(bank, "account_holder"), value(bank, "iban") ? `IBAN: ${value(bank, "iban")}` : "", value(bank, "bic") ? `BIC / SWIFT: ${value(bank, "bic")}` : "", value(bank, "bank_name")])}</Text></View>
        </View>
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>{lines([value(sender, "name"), invoice.invoice_number ?? "Entwurf"]).replace("\n", " · ")}</Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Seite ${pageNumber} von ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );
  diagnostics.onRenderStage?.("renderToBuffer starting", attempt);
  const buffer = await renderToBuffer(document);
  assertValidPdfBuffer(buffer);
  diagnostics.onRenderStage?.("renderToBuffer completed", attempt, {
    byteLength: buffer.byteLength
  });
  return buffer;
}

export async function renderInvoicePdfWithOptionalQrFallback(
  props: Props,
  diagnostics: RenderDiagnostics = {}
): Promise<InvoicePdfRenderResult> {
  diagnostics.onAttemptStarting?.("primary", Boolean(props.qrImage));

  try {
    return {
      buffer: await renderInvoicePdf(props, diagnostics, "primary"),
      qrOmitted: false
    };
  } catch (error) {
    if (!props.qrImage) throw error;

    diagnostics.onOptionalQrError?.(error);
    diagnostics.onAttemptStarting?.("without-optional-qr", false);
    return {
      buffer: await renderInvoicePdf(
        { ...props, qrImage: null, qrLabel: null },
        diagnostics,
        "without-optional-qr"
      ),
      qrOmitted: true
    };
  }
}
