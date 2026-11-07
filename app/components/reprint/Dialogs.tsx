import { appPath } from "@agent-native/core/client/api-path";
import { actionErrorMessage, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconDownload, IconPrinter } from "@tabler/icons-react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";

export interface WeekdayChoice {
  message: string;
  options: { text: string; keeps: string }[];
  retry: (text: string) => void;
}

export function WeekdayDialog({ choice, onClose }: { choice: WeekdayChoice | null; onClose: () => void }) {
  const t = useT();
  return (
    <AlertDialog open={!!choice} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("reprint.weekdayTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{choice?.message.replace(/ Ask which one they mean:.*$/, "")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {choice?.options.map((o) => (
            <Button
              key={o.text}
              variant="outline"
              className="h-auto justify-start whitespace-normal py-2.5 text-left"
              onClick={() => {
                choice.retry(o.text);
                onClose();
              }}
            >
              <span className="font-medium">{o.text}</span>
            </Button>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("reprint.cancel")}</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ExportDialog({ documentId, open, onOpenChange }: { documentId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const [paper, setPaper] = useState<"A4" | "Letter">("A4");
  const [gap, setGap] = useState("3");
  const gapMm = Math.min(20, Math.max(0, Number(gap) || 0));
  const plan = useActionQuery("plan-label-sheet", { documentId, paper, gapMm }, { enabled: open, retry: false });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("reprint.exportTitle")}</DialogTitle>
          <DialogDescription>{t("reprint.exportDescription")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>{t("reprint.paper")}</Label>
            <RadioGroup value={paper} onValueChange={(v) => setPaper(v as "A4" | "Letter")} className="flex gap-4">
              {(["A4", "Letter"] as const).map((p) => (
                <label key={p} className="flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value={p} />
                  {p}
                </label>
              ))}
            </RadioGroup>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="rl-gap">{t("reprint.gap")}</Label>
            <Input id="rl-gap" type="number" min={0} max={20} step={0.5} value={gap} onChange={(e) => setGap(e.target.value)} className="w-28" />
          </div>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            {plan.isPending ? (
              <Skeleton className="h-10 w-full" />
            ) : plan.error ? (
              <p className="text-muted-foreground">{actionErrorMessage(plan.error) ?? t("reprint.exportEmpty")}</p>
            ) : plan.data ? (
              <>
                <p>{t("reprint.sheetSummary", { labels: plan.data.labels.length, sheets: plan.data.sheets })}</p>
                {plan.data.warnings.map((w) => (
                  <p key={w} className="mt-1 text-xs text-[var(--rl-error)]">
                    {w}
                  </p>
                ))}
                <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <IconPrinter className="size-3.5" />
                  {t("reprint.printTip")}
                </p>
              </>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button asChild disabled={!plan.data}>
            <a href={plan.data ? appPath(plan.data.downloadUrl) : undefined} download aria-disabled={!plan.data}>
              <IconDownload className="size-4" />
              {t("reprint.download")}
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
