import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconLock,
  IconMinus,
  IconPlus,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

import { ExportDialog, WeekdayDialog, type WeekdayChoice } from "@/components/reprint/Dialogs";
import { PageView } from "@/components/reprint/PageView";
import { SidePanel, type PanelTab } from "@/components/reprint/SidePanel";
import {
  errorCode,
  errorDetails,
  labelNumbers,
  textUnderRect,
  type DocView,
  type LockView,
  type PatchView,
  type RectView,
  type SuggestionView,
} from "@/components/reprint/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadPdf } from "@/lib/reprint/pdf-store";
import { cn } from "@/lib/utils";

type Draft = { rect: RectView; text: string; printed: string };

export default function ReprintEditor() {
  const t = useT();
  const { documentId = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  const pageIndex = Math.max(0, Number(search.get("page") ?? 0) || 0);
  const selectedId = search.get("patch");
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ id: documentId, includeLines: true }), [documentId]);
  const queryKey = useMemo(() => ["action", "get-document", params], [params]);
  const query = useActionQuery("get-document", params);
  const doc = query.data as DocView | undefined;

  const [bytes, setBytes] = useState<Uint8Array | null | undefined>(undefined);
  const [mode, setMode] = useState<"original" | "repaired">("repaired");
  const [lockMode, setLockMode] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [tab, setTab] = useState<PanelTab>("patches");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [weekday, setWeekday] = useState<WeekdayChoice | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [animating, setAnimating] = useState<Set<string>>(new Set());
  const [explanations, setExplanations] = useState<Map<string, string>>(new Map());
  const [highlight, setHighlight] = useState<string | null>(null);
  const deskRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setBytes(undefined);
    void loadPdf(documentId).then((b) => live && setBytes(b));
    return () => {
      live = false;
    };
  }, [documentId]);

  const page = doc?.pages[pageIndex];
  // Fit the page width to the desk on first load.
  const fitZoom = useCallback(() => {
    const el = deskRef.current;
    if (!el || !page) return 1;
    return Math.max(0.4, Math.min(2.2, (el.clientWidth - 64) / page.width));
  }, [page]);
  useEffect(() => {
    if (page && zoom === null) setZoom(fitZoom());
  }, [page, zoom, fitZoom]);
  const z = zoom ?? 1;

  const select = useCallback(
    (id: string | null) => {
      setSearch(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("patch", id);
          else next.delete("patch");
          return next;
        },
        { replace: true },
      );
    },
    [setSearch],
  );
  const goPage = (p: number) =>
    setSearch((prev) => {
      const next = new URLSearchParams(prev);
      next.set("page", String(p));
      next.delete("patch");
      return next;
    });

  // --- optimistic cache helpers -------------------------------------------
  const snapshot = async () => {
    await queryClient.cancelQueries({ queryKey });
    return { previous: queryClient.getQueryData(queryKey) };
  };
  const patchDoc = (fn: (d: DocView) => DocView) => queryClient.setQueryData(queryKey, (old: DocView | undefined) => (old ? fn(old) : old));
  const rollback = (context: unknown) => queryClient.setQueryData(queryKey, (context as { previous?: unknown } | undefined)?.previous);

  const check = useActionMutation("check-document", {
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("reprint.checkFailed")),
  });
  const runCheck = () => check.mutate({ documentId });

  const offerWeekday = (error: unknown, retry: (text: string) => void) => {
    if (errorCode(error) !== "weekday_mismatch") return false;
    const details = errorDetails(error) as { options?: { text: string; keeps: string }[] } | undefined;
    setWeekday({ message: actionErrorMessage(error) ?? "", options: details?.options ?? [], retry });
    return true;
  };

  const createPatch = useActionMutation("create-patch", {
    onMutate: async (input) => {
      const ctx = await snapshot();
      const target = input.target!;
      const pending: PatchView = {
        id: `pending-${Date.now()}`,
        documentId,
        page: Number(input.page ?? pageIndex),
        rect: { x: target.x - 2, y: target.y - 2, w: target.w + 4, h: target.h + 4 },
        target,
        oldText: draft?.printed ?? "",
        newText: input.newText,
        fontFamily: "sans",
        bold: false,
        fontSize: 10,
        originalFontSize: 10,
        align: "left",
        textColor: "#111111",
        bgColor: "#ffffff",
        border: true,
        layout: { fontSize: 10, lines: [] },
        status: "ok",
        warnings: [],
        source: "user",
      };
      patchDoc((d) => ({ ...d, patches: [...d.patches, pending] }));
      return ctx;
    },
    onError: (error, input, context) => {
      rollback(context);
      if (offerWeekday(error, (text) => createPatch.mutate({ ...input, newText: text }))) return;
      toast.error(actionErrorMessage(error) ?? t("reprint.patchFailed"));
    },
    onSuccess: (result) => {
      setDraft(null);
      select(result.id);
      setTab("patches");
      toast.success(t("reprint.patchCreated"));
      runCheck();
    },
  });

  const updatePatch = useActionMutation("update-patch", {
    onMutate: async (input) => {
      const ctx = await snapshot();
      patchDoc((d) => ({ ...d, patches: d.patches.map((p) => (p.id === input.id && input.rect ? { ...p, rect: input.rect } : p)) }));
      return ctx;
    },
    onError: (error, input, context) => {
      rollback(context);
      if (offerWeekday(error, (text) => updatePatch.mutate({ ...input, newText: text }))) return;
      toast.error(actionErrorMessage(error) ?? t("reprint.updateFailed"));
    },
  });

  const reflow = useActionMutation("reflow-patch", {
    onMutate: ({ id }) => {
      setAnimating((s) => new Set(s).add(id));
    },
    onError: (error) => toast.error(actionErrorMessage(error) ?? t("reprint.fixFailed")),
    onSuccess: (result) => {
      setExplanations((m) => new Map(m).set(result.id, result.explanation));
      patchDoc((d) => ({ ...d, patches: d.patches.map((p) => (p.id === result.id ? result.patch : p)) }));
      if (result.changed) toast.success(result.explanation);
      else toast.message(result.explanation);
    },
    onSettled: (_r, _e, { id }) => {
      window.setTimeout(
        () =>
          setAnimating((s) => {
            const n = new Set(s);
            n.delete(id);
            return n;
          }),
        700,
      );
    },
  });

  const deletePatch = useActionMutation("delete-patch", {
    onMutate: async ({ id }) => {
      const ctx = await snapshot();
      patchDoc((d) => ({ ...d, patches: d.patches.filter((p) => p.id !== id) }));
      if (selectedId === id) select(null);
      return ctx;
    },
    onError: (error, _i, context) => {
      rollback(context);
      toast.error(actionErrorMessage(error) ?? t("reprint.updateFailed"));
    },
    onSuccess: () => runCheck(),
  });

  const createLock = useActionMutation("create-lock", {
    onMutate: async (input) => {
      const ctx = await snapshot();
      const lock: LockView = { id: `pending-${Date.now()}`, documentId, page: Number(input.page ?? pageIndex), rect: input.rect!, label: input.label ?? "" };
      patchDoc((d) => ({ ...d, locks: [...d.locks, lock] }));
      return ctx;
    },
    onError: (error, _i, context) => {
      rollback(context);
      toast.error(actionErrorMessage(error) ?? t("reprint.lockFailed"));
    },
    onSuccess: () => toast.success(t("reprint.lockCreated")),
  });

  const deleteLock = useActionMutation("delete-lock", {
    onMutate: async ({ id }) => {
      const ctx = await snapshot();
      patchDoc((d) => ({ ...d, locks: d.locks.filter((l) => l.id !== id) }));
      return ctx;
    },
    onError: (error, _i, context) => {
      rollback(context);
      toast.error(actionErrorMessage(error) ?? t("reprint.updateFailed"));
    },
  });

  const resolve = useActionMutation("resolve-suggestion", {
    onMutate: async ({ id }) => {
      const ctx = await snapshot();
      patchDoc((d) => ({ ...d, suggestions: d.suggestions.filter((s) => s.id !== id) }));
      return ctx;
    },
    onError: (error, input, context) => {
      rollback(context);
      if (offerWeekday(error, (text) => resolve.mutate({ ...input, newText: text }))) return;
      toast.error(actionErrorMessage(error) ?? t("reprint.resolveFailed"));
    },
    onSuccess: (result) => {
      if (result.patch) {
        toast.success(result.reflow ?? t("reprint.accepted"));
        if (result.reflow) setExplanations((m) => new Map(m).set(result.patch!.id, result.reflow!));
        runCheck();
      }
    },
  });

  // Keyboard: Delete removes the selected label, Escape deselects.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "Escape") select(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const labels = useMemo(() => labelNumbers(doc?.patches ?? []), [doc?.patches]);

  if (query.isPending || bytes === undefined) {
    return (
      <main className="rl-desk flex h-full min-h-0">
        <div className="flex flex-1 items-start justify-center p-8">
          <Skeleton className="aspect-[1/1.414] w-full max-w-2xl rounded-none" />
        </div>
        <div className="hidden w-96 shrink-0 flex-col gap-3 border-s border-border bg-background p-3 lg:flex">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </main>
    );
  }
  if (!doc || !page) {
    return (
      <main className="p-6">
        <p className="text-sm text-muted-foreground">{actionErrorMessage(query.error) ?? t("reprint.notFound")}</p>
        <Link to="/reprint" className="mt-3 inline-block text-sm underline">
          {t("reprint.backToDocuments")}
        </Link>
      </main>
    );
  }

  const pagePatches = doc.patches;
  const onSuggestionClick = (s: SuggestionView) => {
    setTab("found");
    setHighlight(s.id);
    if (s.page !== pageIndex) goPage(s.page);
  };

  return (
    <main className="flex h-full min-h-0 flex-col lg:flex-row">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-3 py-2">
          <Button variant="ghost" size="icon" asChild aria-label={t("reprint.backToDocuments")}>
            <Link to="/reprint">
              <IconArrowLeft className="size-4" />
            </Link>
          </Button>
          <span className="min-w-0 max-w-56 truncate text-sm font-medium">{doc.name}</span>
          {doc.pages.length > 1 ? (
            <div className="flex items-center">
              <Button variant="ghost" size="icon" disabled={pageIndex === 0} onClick={() => goPage(pageIndex - 1)} aria-label={t("reprint.prevPage")}>
                <IconChevronLeft className="size-4" />
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">{t("reprint.pageOf", { page: pageIndex + 1, total: doc.pages.length })}</span>
              <Button
                variant="ghost"
                size="icon"
                disabled={pageIndex >= doc.pages.length - 1}
                onClick={() => goPage(pageIndex + 1)}
                aria-label={t("reprint.nextPage")}
              >
                <IconChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <ToggleGroup type="single" size="sm" variant="outline" value={mode} onValueChange={(v) => v && setMode(v as typeof mode)}>
              <ToggleGroupItem value="original">{t("reprint.original")}</ToggleGroupItem>
              <ToggleGroupItem value="repaired">{t("reprint.repaired")}</ToggleGroupItem>
            </ToggleGroup>
            <Button
              variant={lockMode ? "default" : "outline"}
              size="sm"
              aria-pressed={lockMode}
              title={t("reprint.lockModeHint")}
              onClick={() => setLockMode((v) => !v)}
            >
              <IconLock className="size-4" />
              {t("reprint.lockMode")}
            </Button>
            <div className="flex items-center rounded-md border border-border">
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom(Math.max(0.4, z - 0.15))} aria-label={t("reprint.zoomOut")}>
                <IconMinus className="size-4" />
              </Button>
              <button type="button" className="px-1.5 text-xs tabular-nums text-muted-foreground hover:text-foreground" onClick={() => setZoom(fitZoom())}>
                {Math.round(z * 100)}%
              </button>
              <Button variant="ghost" size="icon" className="size-8" onClick={() => setZoom(Math.min(3, z + 0.15))} aria-label={t("reprint.zoomIn")}>
                <IconPlus className="size-4" />
              </Button>
            </div>
            <Button size="sm" onClick={() => setExportOpen(true)} disabled={doc.patches.length === 0}>
              <IconDownload className="size-4" />
              {t("reprint.export")}
            </Button>
          </div>
        </div>

        <div ref={deskRef} className="rl-desk min-h-0 flex-1 overflow-auto">
          {!bytes ? <p className="px-6 pt-4 text-center text-xs text-[var(--rl-ink)]/70">{t("reprint.wireframe")}</p> : null}
          <div className="flex min-w-max justify-center px-8 py-10">
            <PageView
              doc={doc}
              pageIndex={pageIndex}
              bytes={bytes}
              zoom={z}
              mode={mode}
              lockMode={lockMode}
              selectedId={selectedId}
              animatingIds={animating}
              labels={labels}
              highlightSuggestionId={highlight}
              onSelect={(id) => {
                select(id);
                if (id) setTab("patches");
              }}
              onRectCommit={(id, rect) => {
                if (id.startsWith("pending-")) return;
                updatePatch.mutate({ id, rect });
              }}
              onDraw={(rect, asLock) => {
                const printed = textUnderRect(page.lines, rect);
                if (asLock) {
                  createLock.mutate({ documentId, page: pageIndex, rect, label: printed.slice(0, 60) });
                  return;
                }
                setDraft({ rect, text: printed, printed });
              }}
              onDeleteLock={(lock) => !lock.id.startsWith("pending-") && deleteLock.mutate({ id: lock.id })}
              onSuggestionClick={onSuggestionClick}
            >
              {(toPx) =>
                draft ? (
                  <Popover open onOpenChange={(o) => !o && setDraft(null)}>
                    <PopoverAnchor asChild>
                      <div className="rl-draw pointer-events-none" style={toPx(draft.rect)} />
                    </PopoverAnchor>
                    <PopoverContent className="w-80" align="start" onPointerDown={(e) => e.stopPropagation()}>
                      <form
                        className="grid gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!draft.text.trim()) return;
                          createPatch.mutate({ documentId, page: pageIndex, target: draft.rect, newText: draft.text.trim() });
                        }}
                      >
                        <Label htmlFor="rl-new-text">{t("reprint.correctText")}</Label>
                        <Input
                          id="rl-new-text"
                          autoFocus
                          value={draft.text}
                          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                          onFocus={(e) => e.currentTarget.select()}
                        />
                        {draft.printed ? <p className="truncate text-xs text-muted-foreground">{t("reprint.originalText", { text: draft.printed })}</p> : null}
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                            {t("reprint.cancel")}
                          </Button>
                          <Button type="submit" size="sm" disabled={!draft.text.trim() || createPatch.isPending}>
                            {createPatch.isPending ? t("reprint.making") : t("reprint.makeLabel")}
                          </Button>
                        </div>
                      </form>
                    </PopoverContent>
                  </Popover>
                ) : null
              }
            </PageView>
          </div>
        </div>
      </section>

      <aside className={cn("flex min-h-0 w-full shrink-0 flex-col border-t border-border bg-background lg:h-full lg:w-96 lg:border-s lg:border-t-0", "max-lg:h-[45vh]")}>
        <SidePanel
          tab={tab}
          onTab={setTab}
          patches={pagePatches}
          suggestions={doc.suggestions}
          labels={labels}
          selectedId={selectedId}
          explanations={explanations}
          fixingId={reflow.isPending ? (reflow.variables?.id ?? null) : null}
          checking={check.isPending}
          highlightSuggestionId={highlight}
          resolvingId={resolve.isPending ? (resolve.variables?.id ?? null) : null}
          onSelect={(p) => {
            if (p.page !== pageIndex) goPage(p.page);
            select(p.id);
          }}
          onFix={(p) => reflow.mutate({ id: p.id })}
          onDelete={(p) => deletePatch.mutate({ id: p.id })}
          onCheck={runCheck}
          onResolve={(s, decision, newText) =>
            resolve.mutate({ id: s.id, decision, ...(decision === "accept" && newText && newText !== s.suggestedText ? { newText } : {}) })
          }
          onFocusSuggestion={(s) => setHighlight(s.id)}
        />
      </aside>

      <WeekdayDialog choice={weekday} onClose={() => setWeekday(null)} />
      <ExportDialog documentId={documentId} open={exportOpen} onOpenChange={setExportOpen} />
    </main>
  );
}
