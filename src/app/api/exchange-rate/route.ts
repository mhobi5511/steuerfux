import { NextResponse } from "next/server";
import { fetchHistoricalChfEurRate } from "@/lib/currency";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isValidHistoricalDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Bitte zuerst einloggen." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const requestedFallback = Number(searchParams.get("fallback") ?? "1");
  const fallback = Number.isFinite(requestedFallback) && requestedFallback > 0
    ? requestedFallback
    : 1;

  if (!date) {
    return NextResponse.json({
      rate: fallback,
      manualRequired: true,
      source: "manuell",
      warning: "Bitte zuerst ein relevantes Zahlungsdatum eingeben."
    });
  }

  if (!isValidHistoricalDate(date)) {
    return NextResponse.json({ error: "Das Kursdatum ist ungültig." }, { status: 400 });
  }

  const loadCachedRate = () => supabase
    .from("exchange_rates")
    .select("rate, source")
    .eq("user_id", user.id)
    .eq("rate_date", date)
    .eq("base_currency", "CHF")
    .eq("quote_currency", "EUR")
    .maybeSingle();

  const { data: cachedRate, error: cacheReadError } = await loadCachedRate();
  if (cacheReadError) {
    console.error("exchange-rate cache read error:", cacheReadError);
  }
  if (cachedRate?.rate && Number(cachedRate.rate) > 0) {
    return NextResponse.json({
      rate: Number(cachedRate.rate),
      source: cachedRate.source || "Gespeicherter Kurs",
      manualRequired: cachedRate.source === "manuell",
      cached: true
    });
  }

  const result = await fetchHistoricalChfEurRate(date);
  if (!result.manualRequired && result.rate > 0) {
    const { error: cacheWriteError } = await supabase.from("exchange_rates").insert({
      user_id: user.id,
      rate_date: date,
      base_currency: "CHF",
      quote_currency: "EUR",
      rate: result.rate,
      source: result.source
    });

    // A concurrent request may have inserted the same date. Never upsert here:
    // that could overwrite a manual rate saved at the same moment.
    if (cacheWriteError && cacheWriteError.code !== "23505") {
      console.error("exchange-rate cache write error:", cacheWriteError);
    }
    if (cacheWriteError?.code === "23505") {
      const { data: concurrentRate } = await loadCachedRate();
      if (concurrentRate?.rate && Number(concurrentRate.rate) > 0) {
        return NextResponse.json({
          rate: Number(concurrentRate.rate),
          source: concurrentRate.source || result.source,
          manualRequired: concurrentRate.source === "manuell",
          cached: true
        });
      }
    }
  }

  const payload =
    result.manualRequired && fallback > 0
      ? { ...result, rate: fallback }
      : result;
  return NextResponse.json({ ...payload, cached: false });
}
