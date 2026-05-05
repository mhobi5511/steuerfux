"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resetAllUserData, saveSettings } from "@/app/actions/finance";
import { FormFeedback } from "@/components/forms/form-feedback";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { businessCountryOptions } from "@/lib/constants";
import type { BusinessCountry, CurrencyCode, TaxMode, ThemeMode } from "@/lib/db-types";

export function SettingsForm({
  settings
}: {
  settings: {
    business_owner_name?: string | null;
    business_year?: number;
    business_country?: BusinessCountry;
    reporting_currency?: CurrencyCode;
    theme_mode?: ThemeMode;
    default_home_address?: string;
    default_currency?: CurrencyCode;
    default_manual_chf_eur_rate?: number;
    kleinunternehmer_mode?: boolean;
    default_tax_mode?: TaxMode;
    steuerberater_view?: boolean;
  } | null;
}) {
  const router = useRouter();
  const { themeMode, setThemeMode } = useTheme();
  const [pending, startTransition] = useTransition();
  const [resetPending, startResetTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [selectedThemeMode, setSelectedThemeMode] = useState<ThemeMode>(
    settings?.theme_mode ?? themeMode
  );
  const [selectedBusinessCountry, setSelectedBusinessCountry] = useState<BusinessCountry>(
    settings?.business_country ?? businessCountryOptions[0]
  );
  const [selectedReportingCurrency, setSelectedReportingCurrency] = useState<CurrencyCode>(
    settings?.reporting_currency ??
      (selectedBusinessCountry === "Schweiz" ? "CHF" : "EUR")
  );

  return (
    <>
      <Card className="space-y-5">
        <form
          action={(formData) =>
            startTransition(async () => {
              setError(null);
              setSuccess(null);
              const result = await saveSettings(formData);
              if (result.success) setSuccess(result.success);
              if (result.error) setError(result.error);
            })
          }
          className="grid gap-4 lg:grid-cols-2"
        >
          <Field label="Name des Unternehmers">
            <Input name="business_owner_name" defaultValue={settings?.business_owner_name ?? ""} />
          </Field>
          <Field label="Geschäftsjahr">
            <Input
              name="business_year"
              type="number"
              defaultValue={settings?.business_year ?? new Date().getFullYear()}
            />
          </Field>
          <Field label="Unternehmensland">
            <Select
              name="business_country"
              value={selectedBusinessCountry}
              onChange={(event) => {
                const nextCountry = event.target.value as BusinessCountry;
                setSelectedBusinessCountry(nextCountry);
              }}
            >
              {businessCountryOptions.map((country) => (
                <option key={country} value={country}>
                  {country}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Berichtswährung">
            <Select
              name="reporting_currency"
              value={selectedReportingCurrency}
              onChange={(event) =>
                setSelectedReportingCurrency(event.target.value as CurrencyCode)
              }
            >
              <option value="EUR">EUR</option>
              <option value="CHF">CHF</option>
            </Select>
          </Field>
          <Field label="Designmodus">
            <Select
              name="theme_mode"
              value={selectedThemeMode}
              onChange={(event) => {
                const nextMode = event.target.value as ThemeMode;
                setSelectedThemeMode(nextMode);
                setThemeMode(nextMode);
              }}
            >
              <option value="hell">Hell</option>
              <option value="dunkel">Dunkel</option>
              <option value="system">System</option>
            </Select>
          </Field>
          <Field label="Standard-Home-Adresse">
            <Input
              name="default_home_address"
              defaultValue={settings?.default_home_address ?? "Ottobrunn, München, Deutschland"}
            />
          </Field>
          <Field label="Standardwährung für Eingaben">
            <Select name="default_currency" defaultValue={settings?.default_currency ?? "EUR"}>
              <option value="EUR">EUR</option>
              <option value="CHF">CHF</option>
            </Select>
          </Field>
          <Field label="Manueller CHF/EUR-Fallbackkurs">
            <Input
              name="default_manual_chf_eur_rate"
              type="number"
              step="0.0001"
              defaultValue={settings?.default_manual_chf_eur_rate ?? 1}
            />
          </Field>
          <Field label="Kleinunternehmer-Modus">
            <Select
              name="kleinunternehmer_mode"
              defaultValue={settings?.kleinunternehmer_mode ? "true" : "false"}
            >
              <option value="true">Ja</option>
              <option value="false">Nein</option>
            </Select>
          </Field>
          <Field label="Standard Netto/Brutto">
            <Select name="default_tax_mode" defaultValue={settings?.default_tax_mode ?? "BRUTTO"}>
              <option value="NETTO">NETTO</option>
              <option value="BRUTTO">BRUTTO</option>
            </Select>
          </Field>
          <Field label="Steuerberater-Ansicht aktiv">
            <Select
              name="steuerberater_view"
              defaultValue={settings?.steuerberater_view ? "true" : "false"}
            >
              <option value="false">Nein</option>
              <option value="true">Ja</option>
            </Select>
          </Field>
          <div className="lg:col-span-2">
            <FormFeedback error={error} success={success} />
          </div>
          <div className="lg:col-span-2 flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Speichern..." : "Einstellungen speichern"}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-slate-950">Komplett zurücksetzen</h2>
          <p className="text-sm leading-6 text-slate-600">
            Nutze diese Funktion nur, wenn du wirklich komplett neu starten möchtest.
          </p>
        </div>
        <div className="flex justify-start">
          <Button type="button" variant="danger" onClick={() => setShowResetDialog(true)}>
            Alle Daten löschen und neu starten
          </Button>
        </div>
      </Card>

      {showResetDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
          <Card className="w-full max-w-lg space-y-4">
            <div className="space-y-2">
              <h3 className="text-xl font-semibold text-slate-950">Alle Daten löschen?</h3>
              <p className="text-sm leading-6 text-slate-600">
                Diese Aktion kann nicht rückgängig gemacht werden. Alle Einnahmen, Ausgaben,
                Reisen und Einstellungen werden gelöscht.
              </p>
            </div>
            <FormFeedback error={error} success={null} />
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowResetDialog(false)}
                disabled={resetPending}
              >
                Abbrechen
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={resetPending}
                onClick={() =>
                  startResetTransition(async () => {
                    setError(null);
                    setSuccess(null);
                    const result = await resetAllUserData();

                    if (result.error) {
                      setError(result.error);
                      return;
                    }

                    setThemeMode("system");
                    setShowResetDialog(false);
                    router.push("/dashboard?reset=1");
                    router.refresh();
                  })
                }
              >
                {resetPending ? "Lösche..." : "Endgültig löschen"}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </>
  );
}
