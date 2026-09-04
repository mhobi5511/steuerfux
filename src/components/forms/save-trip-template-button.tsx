"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTripAsTemplate } from "@/app/actions/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SaveTripTemplateButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" variant="ghost" onClick={() => setOpen(true)}>
        Als Vorlage speichern
      </Button>
    );
  }

  return (
    <div className="min-w-[220px] space-y-2 rounded-xl border border-line bg-white p-3 dark:bg-slate-950">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Vorlagenname, z. B. Probe"
        maxLength={80}
        autoFocus
      />
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      {message ? <p className="text-xs text-emerald-700">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending || !name.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setMessage(null);
              const formData = new FormData();
              formData.set("trip_id", tripId);
              formData.set("name", name);
              const result = await saveTripAsTemplate(formData);
              if (result.error) setError(result.error);
              if (result.success) {
                setMessage(result.success);
                setName("");
                router.refresh();
              }
            })
          }
        >
          {pending ? "Speichern..." : "Speichern"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
