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

type Snapshot = Record<string, unknown>;

type Props = {
  invoice: Invoice;
  customer: Snapshot;
  sender: Snapshot;
  bank: Snapshot;
  qrImage: string | null;
  qrLabel: string | null;
};

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", fontSize: 10, color: "#0f172a" },
  top: { flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 28, fontFamily: "Helvetica-Bold" },
  meta: { width: 190, borderLeftWidth: 2, borderLeftColor: "#0f172a", paddingLeft: 12 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  muted: { color: "#64748b" },
  addresses: { flexDirection: "row", gap: 20, marginTop: 30 },
  address: { flexGrow: 1, flexBasis: 0 },
  label: { marginBottom: 7, fontSize: 8, fontFamily: "Helvetica-Bold", color: "#64748b" },
  box: { minHeight: 105, borderWidth: 1, borderColor: "#dbe3ef", padding: 12 },
  due: { marginTop: 24, backgroundColor: "#0f172a", color: "#ffffff", padding: 16 },
  dueAmount: { marginTop: 4, fontSize: 18, fontFamily: "Helvetica-Bold" },
  notice: { marginTop: 16, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", color: "#92400e", padding: 10 },
  table: { marginTop: 24 },
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
  qrLabel: { marginTop: 5, fontSize: 8, color: "#64748b" }
});

function value(snapshot: Snapshot, key: string) {
  return typeof snapshot[key] === "string" ? String(snapshot[key]) : "";
}

function lines(values: Array<string | null | undefined>) {
  return values.filter(Boolean).join("\n");
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

export async function renderInvoicePdf(props: Props) {
  const { invoice, customer, sender, bank, qrImage, qrLabel } = props;
  const items = [...(invoice.items ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const isTaxExempt = invoice.kleinunternehmer || (invoice.vat_total_cents === 0 && Boolean(invoice.tax_note));
  const document = (
    <Document title={`Rechnung ${invoice.invoice_number ?? "Entwurf"}`} author={value(sender, "name")}>
      <Page size="A4" style={styles.page}>
        <View style={styles.top}>
          <Text style={styles.title}>RECHNUNG</Text>
          <View style={styles.meta}>
            <View style={styles.metaRow}><Text style={styles.muted}>Rechnungsnummer</Text><Text>{invoice.invoice_number ?? "Entwurf"}</Text></View>
            <View style={styles.metaRow}><Text style={styles.muted}>Ausstellungsdatum</Text><Text>{formatDate(invoice.issue_date)}</Text></View>
            <View style={styles.metaRow}><Text style={styles.muted}>Status</Text><Text>{invoice.status}</Text></View>
          </View>
        </View>
        <View style={styles.addresses}>
          <AddressBox title="RECHNUNG FÜR"><Text>{lines([value(customer, "company_name"), value(customer, "contact_name"), value(customer, "street"), `${value(customer, "postal_code")} ${value(customer, "city")}`.trim(), value(customer, "country"), "", value(customer, "email")])}</Text></AddressBox>
          <AddressBox title="AUSGESTELLT VON"><Text>{lines([value(sender, "name"), value(sender, "addition"), value(sender, "street"), `${value(sender, "postal_code")} ${value(sender, "city")}`.trim(), value(sender, "country"), "", value(sender, "email"), value(sender, "phone"), value(sender, "tax_id") ? `Steuernummer / UID: ${value(sender, "tax_id")}` : ""])}</Text></AddressBox>
        </View>
        <View style={styles.due}><Text>Zu zahlender Betrag</Text><Text style={styles.dueAmount}>{formatCents(invoice.gross_total_cents, invoice.currency)} fällig bis zum {formatDate(invoice.due_date)}</Text></View>
        {invoice.tax_note ? <View style={styles.notice}><Text>{invoice.tax_note}</Text></View> : null}
        <View style={styles.table}>
          <View style={styles.tableHead}><Text style={styles.description}>Produkt oder Dienstleistung</Text><Text style={styles.quantity}>Menge</Text><Text style={styles.money}>Einzelpreis</Text><Text style={styles.money}>Steuern</Text><Text style={styles.money}>Gesamtbetrag</Text></View>
          {items.map((item) => <ItemRow key={item.id} item={item} invoice={invoice} isTaxExempt={isTaxExempt} />)}
        </View>
        <View style={styles.totals}>
          <View style={styles.totalRow}><Text>Gesamtsumme ohne Steuern</Text><Text>{formatCents(invoice.net_total_cents, invoice.currency)}</Text></View>
          <View style={styles.totalRow}><Text>Gesamtsteuer</Text><Text>{formatCents(invoice.vat_total_cents, invoice.currency)}</Text></View>
          <View style={[styles.totalRow, styles.grand]}><Text>Zu zahlender Betrag</Text><Text>{formatCents(invoice.gross_total_cents, invoice.currency)}</Text></View>
        </View>
        <View style={styles.payment}>
          <View style={styles.paymentColumn}><Text style={styles.label}>ZAHLUNGSMÖGLICHKEITEN</Text><Text>Bitte überweisen Sie den Betrag bis zum Fälligkeitsdatum.</Text>{qrImage ? <><Image style={styles.qr} src={qrImage} /><Text style={styles.qrLabel}>{qrLabel ?? "Zahlungs-QR-Code"}</Text></> : null}</View>
          <View style={styles.paymentColumn}><Text style={styles.label}>BANKVERBINDUNG</Text><Text>{lines([value(bank, "account_holder"), value(bank, "iban") ? `IBAN: ${value(bank, "iban")}` : "", value(bank, "bic") ? `BIC / SWIFT: ${value(bank, "bic")}` : "", value(bank, "bank_name")])}</Text></View>
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(document);
}
