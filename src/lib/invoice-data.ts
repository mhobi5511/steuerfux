import { requireUser } from "@/lib/auth";
import { getAccountingContext } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BankAccount,
  Customer,
  Invoice,
  InvoiceSettings
} from "@/lib/db-types";

export async function getInvoiceModuleData({
  includeInvoices = true,
  includeCustomers = true
}: {
  includeInvoices?: boolean;
  includeCustomers?: boolean;
} = {}) {
  const { supabase, user, settings, activeBuchhaltung } = await getAccountingContext();

  if (!activeBuchhaltung) {
    return {
      settings,
      activeBuchhaltung,
      customers: [] as Customer[],
      invoices: [] as Invoice[],
      invoiceSettings: null as InvoiceSettings | null,
      bankAccounts: [] as BankAccount[]
    };
  }

  const [customers, invoices, invoiceSettings, bankAccounts] = await Promise.all([
    includeCustomers ? supabase
      .from("customers")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .order("company_name", { ascending: true }) : Promise.resolve({ data: [] }),
    includeInvoices ? supabase
      .from("invoices")
      .select("*, invoice_items(*), invoice_payments(*)")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .maybeSingle(),
    supabase
      .from("bank_accounts")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .order("is_default", { ascending: false })
      .order("label", { ascending: true })
  ]);

  return {
    settings,
    activeBuchhaltung,
    customers: (customers.data ?? []) as Customer[],
    invoices: (invoices.data ?? []).map((invoice) => ({
      ...invoice,
      items: invoice.invoice_items ?? [],
      payments: invoice.invoice_payments ?? []
    })) as Invoice[],
    invoiceSettings: invoiceSettings.data as InvoiceSettings | null,
    bankAccounts: (bankAccounts.data ?? []) as BankAccount[]
  };
}

export async function getInvoiceForView(id: string) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError) console.error("invoice PDF authentication error:", authError);
  if (!user) throw new InvoiceAccessError("UNAUTHENTICATED");

  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*), invoice_payments(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("invoice PDF data load error:", error);
    throw new InvoiceAccessError("LOAD_FAILED");
  }
  if (!data) return null;
  return {
    ...data,
    items: data.invoice_items ?? [],
    payments: data.invoice_payments ?? []
  } as Invoice;
}

export class InvoiceAccessError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "LOAD_FAILED") {
    super(code);
    this.name = "InvoiceAccessError";
  }
}

export async function createInvoiceAssetDataUrl(
  storagePath: string,
  buchhaltungId: string
) {
  const { supabase, user } = await requireUser();
  if (!storagePath.startsWith(`${user.id}/${buchhaltungId}/`)) {
    console.warn("Rejected invoice asset outside the authenticated Buchhaltung path.");
    return null;
  }

  const { data, error } = await supabase.storage
    .from("invoice-assets")
    .download(storagePath);
  if (error || !data) {
    console.warn("invoice QR asset download error:", error);
    return null;
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const isPng = bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47;
  const isJpeg = bytes.length >= 3
    && bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff;
  if (!isPng && !isJpeg) {
    console.warn("Invoice QR asset is not a supported PNG or JPEG image.");
    return null;
  }

  const contentType = isPng ? "image/png" : "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function getInvoicePaymentFallback(invoice: Invoice) {
  const { supabase, user } = await requireUser();
  if (invoice.user_id !== user.id) {
    return { bank: null as BankAccount | null, invoiceSettings: null as InvoiceSettings | null };
  }

  const loadBank = (id?: string | null) => id
    ? supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", invoice.buchhaltung_id)
        .maybeSingle()
    : null;
  const selected = await loadBank(invoice.bank_account_id);
  if (selected?.data) {
    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", user.id)
      .eq("buchhaltung_id", invoice.buchhaltung_id)
      .maybeSingle();
    return { bank: selected.data as BankAccount, invoiceSettings: invoiceSettings as InvoiceSettings | null };
  }

  const { data: matchingDefault } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("user_id", user.id)
    .eq("buchhaltung_id", invoice.buchhaltung_id)
    .eq("currency", invoice.currency)
    .eq("is_default", true)
    .maybeSingle();
  const { data: firstAccount } = matchingDefault
    ? { data: null }
    : await supabase
        .from("bank_accounts")
        .select("*")
        .eq("user_id", user.id)
        .eq("buchhaltung_id", invoice.buchhaltung_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
  const { data: invoiceSettings } = await supabase
    .from("invoice_settings")
    .select("*")
    .eq("user_id", user.id)
    .eq("buchhaltung_id", invoice.buchhaltung_id)
    .maybeSingle();
  return {
    bank: (matchingDefault ?? firstAccount) as BankAccount | null,
    invoiceSettings: invoiceSettings as InvoiceSettings | null
  };
}
