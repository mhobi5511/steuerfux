import { getAccountingContext } from "@/lib/data";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BankAccount,
  Customer,
  Invoice,
  InvoiceSettings
} from "@/lib/db-types";

const MAX_INVOICE_ASSET_BYTES = 5 * 1024 * 1024;

type InvoicePdfAccess = {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  userId: string;
};

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
  if (authError) {
    console.error("[invoice-pdf] authentication lookup failed", {
      name: authError.name,
      message: authError.message,
      status: authError.status
    });
  }
  if (!user) throw new InvoiceAccessError("UNAUTHENTICATED");

  const { data, error } = await supabase
    .from("invoices")
    .select("*, invoice_items(*), invoice_payments(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[invoice-pdf] invoice data load failed", {
      code: error.code,
      message: error.message
    });
    throw new InvoiceAccessError("LOAD_FAILED");
  }
  if (!data) return null;
  return {
    invoice: {
      ...data,
      items: data.invoice_items ?? [],
      payments: data.invoice_payments ?? []
    } as Invoice,
    access: {
      supabase,
      userId: user.id
    } satisfies InvoicePdfAccess
  };
}

export class InvoiceAccessError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "LOAD_FAILED") {
    super(code);
    this.name = "InvoiceAccessError";
  }
}

export async function createInvoiceAssetDataUrl(
  storagePath: string,
  buchhaltungId: string,
  access: InvoicePdfAccess
) {
  const { supabase, userId } = access;
  if (!storagePath.startsWith(`${userId}/${buchhaltungId}/`)) {
    console.warn("Rejected invoice asset outside the authenticated Buchhaltung path.");
    return null;
  }

  const { data, error } = await supabase.storage
    .from("invoice-assets")
    .download(storagePath);
  if (error || !data) {
    console.warn("[invoice-pdf] QR asset download failed", {
      name: error?.name,
      message: error?.message
    });
    return null;
  }

  if (data.size === 0 || data.size > MAX_INVOICE_ASSET_BYTES) {
    console.warn("[invoice-pdf] QR asset rejected because of its size", {
      byteLength: data.size,
      maximumByteLength: MAX_INVOICE_ASSET_BYTES
    });
    return null;
  }

  const bytes = new Uint8Array(await data.arrayBuffer());
  const isPng = bytes.length >= 24
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
    && bytes[12] === 0x49
    && bytes[13] === 0x48
    && bytes[14] === 0x44
    && bytes[15] === 0x52;
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

export async function getInvoicePaymentFallback(
  invoice: Invoice,
  access: InvoicePdfAccess
) {
  const { supabase, userId } = access;
  if (invoice.user_id !== userId) {
    return { bank: null as BankAccount | null, invoiceSettings: null as InvoiceSettings | null };
  }

  const loadBank = (id?: string | null) => id
    ? supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .eq("buchhaltung_id", invoice.buchhaltung_id)
        .maybeSingle()
    : null;
  const selected = await loadBank(invoice.bank_account_id);
  if (selected?.data) {
    const { data: invoiceSettings } = await supabase
      .from("invoice_settings")
      .select("*")
      .eq("user_id", userId)
      .eq("buchhaltung_id", invoice.buchhaltung_id)
      .maybeSingle();
    return { bank: selected.data as BankAccount, invoiceSettings: invoiceSettings as InvoiceSettings | null };
  }

  const { data: matchingDefault } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("user_id", userId)
    .eq("buchhaltung_id", invoice.buchhaltung_id)
    .eq("currency", invoice.currency)
    .eq("is_default", true)
    .maybeSingle();
  const { data: firstAccount } = matchingDefault
    ? { data: null }
    : await supabase
        .from("bank_accounts")
        .select("*")
        .eq("user_id", userId)
        .eq("buchhaltung_id", invoice.buchhaltung_id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
  const { data: invoiceSettings } = await supabase
    .from("invoice_settings")
    .select("*")
    .eq("user_id", userId)
    .eq("buchhaltung_id", invoice.buchhaltung_id)
    .maybeSingle();
  return {
    bank: (matchingDefault ?? firstAccount) as BankAccount | null,
    invoiceSettings: invoiceSettings as InvoiceSettings | null
  };
}
