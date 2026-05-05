"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { login, register } from "@/app/actions/auth";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action = mode === "login" ? login : register;

  return (
    <Card className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-brand-700">Geschützter Zugang</p>
        <h1 className="text-2xl font-semibold text-slate-950">
          {mode === "login" ? "Anmelden" : "Konto erstellen"}
        </h1>
        <p className="text-sm leading-6 text-slate-600">
          {mode === "login"
            ? "Nur angemeldete Nutzer sehen ihre eigenen Buchhaltungsdaten."
            : "Registriere dich mit E-Mail und Passwort. Danach kannst du deine eigene Buchhaltung privat verwalten."}
        </p>
      </div>

      <form
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSuccess(null);
            const result = await action(formData);
            setSuccess(result && "success" in result ? result.success ?? null : null);
            setError(result && "error" in result ? result.error ?? null : null);
          })
        }
        className="space-y-4"
      >
        <Field label="E-Mail">
          <Input name="email" type="email" required placeholder="name@beispiel.de" />
        </Field>
        <Field label="Passwort" hint="Mindestens 6 Zeichen.">
          <Input name="password" type="password" required minLength={6} />
        </Field>

        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending
            ? "Bitte warten..."
            : mode === "login"
              ? "Anmelden"
              : "Registrieren"}
        </Button>
      </form>

      <p className="text-sm text-slate-600">
        {mode === "login" ? "Noch kein Konto?" : "Schon registriert?"}{" "}
        <Link className="font-medium text-brand-700" href={mode === "login" ? "/register" : "/login"}>
          {mode === "login" ? "Jetzt registrieren" : "Zum Login"}
        </Link>
      </p>
    </Card>
  );
}
