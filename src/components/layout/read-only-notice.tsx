import { Card } from "@/components/ui/card";

export function ReadOnlyNotice() {
  return (
    <Card className="border-amber-200 bg-amber-50">
      <p className="text-sm font-medium text-amber-800">
        Diese Buchhaltung ist abgeschlossen und schreibgeschützt.
      </p>
    </Card>
  );
}
