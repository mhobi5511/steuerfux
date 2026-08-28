import { requireUser } from "@/lib/auth";
import { getSelectedBuchhaltung } from "@/lib/buchhaltungen";
import type {
  BankAccount,
  Customer,
  Invoice,
  InvoiceSettings
} from "@/lib/db-types";

export async function getInvoiceModuleData() {
  const { supabase, user } = await requireUser();
  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  const { activeBuchhaltung } = await getSelectedBuchhaltung(supabase, user, settings);

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
    supabase
      .from("customers")
      .select("*")
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .order("company_name", { ascending: true }),
    supabase
      .from("invoices")
      .select("*, invoice_items(*), invoice_payments(*)")
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("invoice_settings")
      .select("*")
      .eq("buchhaltung_id", activeBuchhaltung.id)
      .maybeSingle(),
    supabase
      .from("bank_accounts")
      .select("*")
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
  const { supabase, user } = await requireUser();
  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  const { activeBuchhaltung } = await getSelectedBuchhaltung(supabase, user, settings);
  if (!activeBuchhaltung) return null;

  const { data } = await supabase
    .from("invoices")
    .select("*, invoice_items(*), invoice_payments(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .maybeSingle();

  if (!data) return null;
  return {
    ...data,
    items: data.invoice_items ?? [],
    payments: data.invoice_payments ?? []
  } as Invoice;
}

export async function createInvoiceAssetSignedUrl(storagePath: string) {
  const { supabase } = await requireUser();
  const { data, error } = await supabase.storage
    .from("invoice-assets")
    .createSignedUrl(storagePath, 60 * 5);
  if (error) return null;
  return data.signedUrl;
}

export async function getInvoicePaymentFallback(invoice: Invoice) {
  const { supabase, user } = await requireUser();
  const { data: settings } = await supabase.from("settings").select("*").maybeSingle();
  const { activeBuchhaltung } = await getSelectedBuchhaltung(supabase, user, settings);
  if (!activeBuchhaltung || invoice.buchhaltung_id !== activeBuchhaltung.id) {
    return { bank: null as BankAccount | null, invoiceSettings: null as InvoiceSettings | null };
  }

  const loadBank = (id?: string | null) => id
    ? supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
        .maybeSingle()
    : null;
  const selected = await loadBank(invoice.bank_account_id);
  if (selected?.data) {
    const { data: invoiceSettings } = await supabase.from("invoice_settings").select("*").eq("buchhaltung_id", activeBuchhaltung.id).maybeSingle();
    return { bank: selected.data as BankAccount, invoiceSettings: invoiceSettings as InvoiceSettings | null };
  }

  const { data: matchingDefault } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("user_id", user.id)
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .eq("currency", invoice.currency)
    .eq("is_default", true)
    .maybeSingle();
  const { data: firstAccount } = matchingDefault
    ? { data: null }
    : await supabase
        .from("bank_accounts")
        .select("*")
        .eq("user_id", user.id)
        .eq("buchhaltung_id", activeBuchhaltung.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
  const { data: invoiceSettings } = await supabase
    .from("invoice_settings")
    .select("*")
    .eq("buchhaltung_id", activeBuchhaltung.id)
    .maybeSingle();
  return {
    bank: (matchingDefault ?? firstAccount) as BankAccount | null,
    invoiceSettings: invoiceSettings as InvoiceSettings | null
  };
}
