import { appPath } from "@agent-native/core/client/api-path";
import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFileTypePdf, IconLoader2, IconToolsKitchen2, IconTrash, IconUpload, IconCalendarEvent } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { extractPdf, PdfError } from "@/lib/reprint/pdf-client";
import { deletePdf, savePdf } from "@/lib/reprint/pdf-store";
import { cn } from "@/lib/utils";

type Doc = { id: string; name: string; pageCount: number; createdAt: string };

export default function ReprintIndex() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Doc | null>(null);
  const docs = useActionQuery("list-documents", {});
  const create = useActionMutation("create-document");
  const listKey = ["action", "list-documents", {}];
  const remove = useActionMutation("delete-document", {
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData(listKey);
      queryClient.setQueryData(listKey, (old: { documents: Doc[] } | undefined) => old && { documents: old.documents.filter((d) => d.id !== id) });
      return { previous };
    },
    onError: (error, _v, context) => {
      queryClient.setQueryData(listKey, (context as { previous?: unknown } | undefined)?.previous);
      toast.error(actionErrorMessage(error) ?? t("reprint.deleteFailed"));
    },
    onSuccess: (_r, { id }) => void deletePdf(id),
  });

  async function open(name: string, bytes: Uint8Array) {
    setBusy(t("reprint.reading", { done: 0, total: "…" }));
    try {
      const pages = await extractPdf(bytes, (done, total) => setBusy(t("reprint.reading", { done, total })));
      setBusy(t("reprint.saving"));
      const result = await create.mutateAsync({ name, pages });
      await savePdf(result.id, bytes);
      navigate(`/reprint/${result.id}`);
    } catch (error) {
      toast.error(error instanceof PdfError ? error.message : (actionErrorMessage(error) ?? t("reprint.importFailed")));
      setBusy(null);
    }
  }

  async function openFile(file: File | undefined) {
    if (!file) return;
    void open(file.name, new Uint8Array(await file.arrayBuffer()));
  }

  async function openSample(file: string) {
    setBusy(t("reprint.reading", { done: 0, total: 1 }));
    try {
      const res = await fetch(appPath(`/samples/${file}`));
      if (!res.ok) throw new Error();
      await open(file, new Uint8Array(await res.arrayBuffer()));
    } catch {
      toast.error(t("reprint.importFailed"));
      setBusy(null);
    }
  }

  return (
    <main className="rl-desk min-h-full overflow-y-auto">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
        <section
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void openFile(e.dataTransfer.files[0]);
          }}
          className={cn(
            "rl-paper flex flex-col items-center gap-4 px-6 py-12 text-center text-[var(--rl-ink)] transition-transform sm:px-12",
            dragOver && "scale-[1.01]",
          )}
        >
          <div className="flex size-12 items-center justify-center rounded-full bg-[#f3ead9]">
            {busy ? <IconLoader2 className="size-6 motion-safe:animate-spin" /> : <IconFileTypePdf className="size-6" />}
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{busy ?? t("reprint.dropTitle")}</h1>
          <p className="max-w-md text-sm text-[#6b6257]">{t("reprint.dropHint")}</p>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void openFile(e.target.files?.[0])} />
          <Button onClick={() => fileRef.current?.click()} disabled={!!busy}>
            <IconUpload className="size-4" />
            {t("reprint.chooseFile")}
          </Button>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="text-[#6b6257]">{t("reprint.trySample")}:</span>
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void openSample("flyer.pdf")}>
              <IconCalendarEvent className="size-4" />
              {t("reprint.sampleFlyer")}
            </Button>
            <Button variant="outline" size="sm" disabled={!!busy} onClick={() => void openSample("menu.pdf")}>
              <IconToolsKitchen2 className="size-4" />
              {t("reprint.sampleMenu")}
            </Button>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-[var(--rl-ink)]/70">{t("reprint.yourDocuments")}</h2>
          {docs.isPending ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-28 rounded-md" />
              ))}
            </div>
          ) : docs.data?.documents.length ? (
            <ul className="grid gap-3 sm:grid-cols-3">
              {docs.data.documents.map((d) => (
                <li key={d.id} className="group relative">
                  <Link
                    to={`/reprint/${d.id}`}
                    className="block rounded-sm bg-white p-4 text-[var(--rl-ink)] shadow-[0_1px_2px_rgba(40,30,15,.12),0_8px_18px_-8px_rgba(60,40,10,.35)] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <IconFileTypePdf className="size-5 text-[#b4441f]" />
                    <p className="mt-3 truncate text-sm font-medium">{d.name}</p>
                    <p className="text-xs text-[#6b6257]">
                      {t("reprint.pages", { count: d.pageCount })} · {new Date(d.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                  <button
                    type="button"
                    aria-label={t("reprint.deleteDocument")}
                    onClick={() => setPendingDelete(d)}
                    className="absolute right-2 top-2 rounded p-1 text-[#6b6257] opacity-0 transition-opacity hover:bg-black/5 focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <IconTrash className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--rl-ink)]/60">{t("reprint.emptyDocuments")}</p>
          )}
        </section>
      </div>
      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reprint.deleteDocumentTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("reprint.deleteDocumentDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("reprint.keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) remove.mutate({ id: pendingDelete.id });
                setPendingDelete(null);
              }}
            >
              {t("reprint.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
