import { NextResponse } from "next/server";
import { fetchHistoricalChfEurRate } from "@/lib/currency";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? "";
  const fallback = Number(searchParams.get("fallback") ?? "1");

  if (!date) {
    return NextResponse.json({
      rate: fallback,
      manualRequired: true,
      source: "manuell",
      warning: "Bitte zuerst ein relevantes Zahlungsdatum eingeben."
    });
  }

  const result = await fetchHistoricalChfEurRate(date);
  const payload =
    result.manualRequired && fallback > 0
      ? { ...result, rate: fallback }
      : result;
  return NextResponse.json(payload);
}
