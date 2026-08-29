"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function DeleteButton({
  action,
  id,
  label = "Eintrag"
}: {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm(`${label} wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) {
          return;
        }
        const formData = new FormData();
        formData.set("id", id);
        startTransition(async () => {
          await action(formData);
        });
      }}
    >
      {pending ? "Wird gelöscht..." : "Löschen"}
    </Button>
  );
}
