import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import { AgentToggleButton } from "@agent-native/toolkit/app/chat";
import {
  IconArrowRight,
  IconCheck,
  IconMessageCircle,
  IconRefresh,
  IconSparkles,
  IconTrash,
  IconWand,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import type { PatchView, SuggestionView } from "./types";

export type PanelTab = "patches" | "found" | "chat";

const DOT = { ok: "bg-[var(--rl-ok)]", warn: "bg-[var(--rl-warn)]", error: "bg-[var(--rl-error)]" } as const;

interface Props {
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  patches: PatchView[];
  suggestions: SuggestionView[];
  labels: Map<string, string>;
  selectedId: string | null;
  explanations: Map<string, string>;
  fixingId: string | null;
  checking: boolean;
  highlightSuggestionId: string | null;
  resolvingId: string | null;
  onSelect: (p: PatchView) => void;
  onFix: (p: PatchView) => void;
  onDelete: (p: PatchView) => void;
  onCheck: () => void;
  onResolve: (s: SuggestionView, decision: "accept" | "dismiss", newText?: string) => void;
  onFocusSuggestion: (s: SuggestionView) => void;
}

export function SidePanel(props: Props) {
  const t = useT();
  const open = props.suggestions.filter((s) => s.status === "open");
  return (
    <Tabs value={props.tab} onValueChange={(v) => props.onTab(v as PanelTab)} className="flex h-full min-h-0 flex-col">
      <TabsList className="mx-3 mt-3 grid grid-cols-3">
        <TabsTrigger value="patches" className="gap-1.5">
          {t("reprint.tabPatches")}
          {props.patches.length ? <span className="text-xs text-muted-foreground">{props.patches.length}</span> : null}
        </TabsTrigger>
        <TabsTrigger value="found" className="gap-1.5">
          {t("reprint.tabFound")}
          {open.length ? (
            <span className="inline-flex min-w-4 items-center justify-center rounded-full bg-[var(--rl-warn)] px-1 text-[10px] font-semibold leading-4 text-white">
              {open.length}
            </span>
          ) : null}
        </TabsTrigger>
        <TabsTrigger value="chat">{t("reprint.tabChat")}</TabsTrigger>
      </TabsList>

      <TabsContent value="patches" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        {props.patches.length === 0 ? (
          <p className="px-1 py-6 text-sm text-muted-foreground">{t("reprint.noPatches")}</p>
        ) : (
          <ul className="space-y-2">
            {props.patches.map((p) => (
              <PatchItem key={p.id} {...props} patch={p} />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="found" className="mt-0 min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3">
        <div className="mb-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={props.onCheck} disabled={props.checking}>
            <IconRefresh className={cn("size-4", props.checking && "motion-safe:animate-spin")} />
            {props.checking ? t("reprint.checking") : t("reprint.runCheck")}
          </Button>
        </div>
        {open.length === 0 ? (
          <p className="px-1 py-4 text-sm text-muted-foreground">{t("reprint.noSuggestions")}</p>
        ) : (
          <ul className="space-y-2">
            {open.map((s) => (
              <SuggestionItem key={s.id} {...props} s={s} />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="chat" className="mt-0 min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <p className="text-sm leading-relaxed text-muted-foreground">{t("reprint.chatIntro")}</p>
        <div className="mt-4 flex flex-col gap-2">
          {[t("reprint.promptFindMore"), t("reprint.promptFixRed"), t("reprint.promptPrices")].map((prompt) => (
            <button
              key={prompt}
              type="button"
              className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => sendToAgentChat({ message: prompt, submit: true, openSidebar: true })}
            >
              <IconSparkles className="size-4 shrink-0 text-[var(--rl-warn)]" />
              <span className="min-w-0 flex-1">{prompt}</span>
              <IconArrowRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2 text-sm">
          <IconMessageCircle className="size-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t("reprint.openChat")}</span>
          <AgentToggleButton showWhenOpen />
        </div>
      </TabsContent>
    </Tabs>
  );
}

function PatchItem(props: Props & { patch: PatchView }) {
  const t = useT();
  const { patch } = props;
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const selected = props.selectedId === patch.id;
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);
  const label = props.labels.get(patch.id) ?? "";
  const statusText = { ok: t("reprint.statusOk"), warn: t("reprint.statusWarn"), error: t("reprint.statusError") }[patch.status];
  const warnings = patch.warnings.filter((w) => w.level !== "info");
  const info = patch.warnings.filter((w) => w.level === "info");
  const explanation = props.explanations.get(patch.id);
  const pending = patch.id.startsWith("pending-");
  return (
    <li ref={ref}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => props.onSelect(patch)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && props.onSelect(patch)}
        className={cn(
          "rounded-lg border bg-card p-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected ? "border-foreground/40 shadow-sm" : "border-border hover:border-foreground/20",
          pending && "opacity-60",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-muted-foreground">{label}</span>
          <span className={cn("size-2 rounded-full", DOT[patch.status])} aria-hidden />
          <span className="text-xs text-muted-foreground">{statusText}</span>
          <span className="ml-auto text-xs text-muted-foreground">
            {Math.round(patch.rect.w)}×{Math.round(patch.rect.h)}pt · {patch.layout.fontSize}pt
          </span>
        </div>
        <p className="mt-1.5 break-words">
          {patch.oldText ? <span className="text-muted-foreground line-through decoration-[var(--rl-error)]/60">{patch.oldText}</span> : null}
          {patch.oldText ? <IconArrowRight className="mx-1 inline size-3.5 text-muted-foreground" /> : null}
          <span className="font-medium">{patch.newText}</span>
        </p>
        {warnings.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i} className={cn("text-xs", w.level === "error" ? "text-[var(--rl-error)]" : "text-[var(--rl-warn)]")}>
                {w.message}
              </li>
            ))}
          </ul>
        ) : null}
        {info.length ? <p className="mt-1 text-xs text-muted-foreground">{info.map((w) => w.message).join(" ")}</p> : null}
        {explanation ? (
          <p className="mt-1.5 flex gap-1.5 rounded-md bg-[var(--rl-ok)]/10 px-2 py-1 text-xs text-[var(--rl-ok)]">
            <IconWand className="mt-0.5 size-3.5 shrink-0" />
            {explanation}
          </p>
        ) : null}
        {!pending ? (
          <div className="mt-2 flex items-center gap-1.5">
            {patch.status === "error" ? (
              <Button
                size="sm"
                className="h-7"
                disabled={props.fixingId === patch.id}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onFix(patch);
                }}
              >
                <IconWand className="size-3.5" />
                {props.fixingId === patch.id ? t("reprint.fixing") : t("reprint.fixIt")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7 text-muted-foreground"
              aria-label={t("reprint.deletePatch")}
              onClick={(e) => {
                e.stopPropagation();
                setConfirm(true);
              }}
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reprint.deletePatchTitle", { label })}</AlertDialogTitle>
            <AlertDialogDescription>{t("reprint.deletePatchDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("reprint.keep")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => props.onDelete(patch)}>{t("reprint.delete")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function SuggestionItem(props: Props & { s: SuggestionView }) {
  const t = useT();
  const { s } = props;
  const [text, setText] = useState(s.suggestedText);
  const kind = {
    related: t("reprint.kindRelated"),
    weekday: t("reprint.kindWeekday"),
    past_date: t("reprint.kindPastDate"),
    combo: t("reprint.kindCombo"),
    currency: t("reprint.kindCurrency"),
  }[s.kind];
  const busy = props.resolvingId === s.id;
  const highlighted = props.highlightSuggestionId === s.id;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [highlighted]);
  return (
    <li ref={ref}>
      <div
        className={cn("rounded-lg border bg-card p-3 text-sm", highlighted ? "border-[var(--rl-warn)]" : "border-border")}
        onMouseEnter={() => props.onFocusSuggestion(s)}
      >
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            {kind}
          </Badge>
          <span className="text-xs text-muted-foreground">p.{s.page + 1}</span>
        </div>
        <p className="mt-1.5 leading-snug">{s.message}</p>
        <div className="mt-2 flex items-center gap-1.5">
          <span className="truncate font-mono text-xs text-muted-foreground line-through">{s.oldText}</span>
          <IconArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("reprint.replacement")}
            placeholder={t("reprint.replacement")}
            className="h-7 min-w-0 flex-1 font-mono text-xs"
          />
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => props.onResolve(s, "dismiss")}>
            <IconX className="size-3.5" />
            {t("reprint.dismiss")}
          </Button>
          <Button size="sm" className="h-7" disabled={busy || !text.trim()} onClick={() => props.onResolve(s, "accept", text.trim())}>
            <IconCheck className="size-3.5" />
            {t("reprint.accept")}
          </Button>
        </div>
      </div>
    </li>
  );
}
