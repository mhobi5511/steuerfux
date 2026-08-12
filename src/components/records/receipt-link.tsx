"use client";

import { useState, useTransition } from "react";
import { getReceiptViewUrl } from "@/app/actions/finance";
import { Button } from "@/components/ui/button";

export function ReceiptLink({ receiptId }: { receiptId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-1">
      <Button
        type="button"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const formData = new FormData();
            formData.set("receipt_id", receiptId);
            const result = await getReceiptViewUrl(formData);
            if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
            setError(result.error ?? null);
          })
        }
      >
        {pending ? "Öffne..." : "Beleg ansehen"}
      </Button>
      {error ? <p className="text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
