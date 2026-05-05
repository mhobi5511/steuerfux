import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DistanceRequest = {
  origin?: string;
  destination?: string;
};

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
  }>;
  error?: {
    message?: string;
  };
};

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Bitte zuerst einloggen." }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Google Maps ist noch nicht eingerichtet." },
      { status: 500 }
    );
  }

  let payload: DistanceRequest;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Anfrage konnte nicht gelesen werden." }, { status: 400 });
  }

  const origin = payload.origin?.trim();
  const destination = payload.destination?.trim();

  if (!origin || !destination) {
    return NextResponse.json(
      { error: "Start und Ziel müssen ausgefüllt sein." },
      { status: 400 }
    );
  }

  const googleResponse = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.distanceMeters"
    },
    body: JSON.stringify({
      origin: { address: origin },
      destination: { address: destination },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      units: "METRIC"
    })
  });

  const result = (await googleResponse.json()) as GoogleRoutesResponse;

  if (!googleResponse.ok) {
    return NextResponse.json(
      { error: result.error?.message ?? "Google Maps konnte die Strecke nicht berechnen." },
      { status: googleResponse.status }
    );
  }

  const distanceMeters = result.routes?.[0]?.distanceMeters;
  if (!distanceMeters) {
    return NextResponse.json(
      { error: "Für diese Strecke wurde keine Autofahrt gefunden." },
      { status: 404 }
    );
  }

  return NextResponse.json({
    distanceMeters,
    kilometers: Math.round((distanceMeters / 1000) * 10) / 10
  });
}
