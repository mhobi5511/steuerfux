"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function translateSupabaseAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("user already registered")) {
    return "Diese E-Mail-Adresse ist bereits registriert.";
  }
  if (normalized.includes("invalid email")) {
    return "Bitte gib eine gueltige E-Mail-Adresse ein.";
  }
  if (normalized.includes("password should be at least 6 characters")) {
    return "Das Passwort muss mindestens 6 Zeichen lang sein.";
  }
  if (normalized.includes("signup is disabled")) {
    return "Die Registrierung ist derzeit deaktiviert.";
  }
  if (normalized.includes("email rate limit exceeded")) {
    return "Zu viele Registrierungsversuche. Bitte versuche es spaeter erneut.";
  }

  return message;
}

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const supabase = createSupabaseServerClient();

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: "Anmeldung fehlgeschlagen. Bitte E-Mail und Passwort pruefen." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function register(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!isValidEmail(email)) {
    return { error: "Bitte gib eine gueltige E-Mail-Adresse ein." };
  }

  if (password.length < 6) {
    return { error: "Das Passwort muss mindestens 6 Zeichen lang sein." };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    console.error("Supabase signUp error:", error);
    return { error: translateSupabaseAuthError(error.message) };
  }

  if (data.user && !data.session) {
    return {
      success:
        "Registrierung erfolgreich. Bitte bestaetige deine E-Mail-Adresse, bevor du dich einloggst."
    };
  }

  if (data.user) {
    revalidatePath("/", "layout");
    return { success: "Registrierung erfolgreich" };
  }

  console.error("Supabase signUp returned neither error nor user:", data);
  return {
    error: "Die Registrierung konnte nicht abgeschlossen werden. Bitte versuche es erneut."
  };
}

export async function logout() {
  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
