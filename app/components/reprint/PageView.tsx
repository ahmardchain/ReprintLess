import { useT } from "@agent-native/core/client/i18n";
import { IconLock, IconX } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { renderPage } from "@/lib/reprint/pdf-client";
import { cn } from "@/lib/utils";

import {
  DEJAVU_ASCENT,
  FONT_CSS,
  type DocView,
  type LockView,
  type PatchView,
  type RectView,
  type SuggestionView,
} from "./types";

const ASCENT_RATIO = 0.78;
type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

type Drag =
  | { kind: "draw"; start: { x: number; y: number }; rect: RectView; lock: boolean }
  | { kind: "move"; id: string; start: { x: number; y: number }; origin: RectView; rect: RectView }
  | { kind: "resize"; id: string; handle: Handle; start: { x: number; y: number }; origin: RectView; rect: RectView };

export interface PageViewProps {
  doc: DocView;
  pageIndex: number;
  bytes: Uint8Array | null;
  zoom: number;
  mode: "original" | "repaired";
  lockMode: boolean;
  selectedId: string | null;
  animatingIds: Set<string>;
  labels: Map<string, string>;
  highlightSuggestionId: string | null;
  onSelect: (id: string | null) => void;
  onRectCommit: (id: string, rect: RectView) => void;
  onDraw: (rect: RectView, asLock: boolean) => void;
  onDeleteLock: (lock: LockView) => void;
  onSuggestionClick: (s: SuggestionView) => void;
  /** Rendered inside the overlay, e.g. the popover anchor for a new mark. */
  children?: (toPx: (r: RectView) => React.CSSProperties) => ReactNode;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function PageView(props: PageViewProps) {
  const { doc, pageIndex, bytes, zoom, mode, selectedId } = props;
  const t = useT();
  const page = doc.pages[pageIndex];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    if (!bytes || !canvasRef.current) return;
    const signal = { cancelled: false };
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const timer = window.setTimeout(() => {
      renderPage(bytes, pageIndex, canvasRef.current!, zoom * dpr, signal)
        .then(() => !signal.cancelled && setRendered(true))
        .catch(() => setRendered(false));
    }, 60);
    return () => {
      signal.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bytes, pageIndex, zoom]);

  if (!page) return null;
  const W = page.width * zoom;
  const H = page.height * zoom;
  const toPx = (r: RectView): React.CSSProperties => ({ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom });

  const toPt = (e: React.PointerEvent) => {
    const b = overlayRef.current!.getBoundingClientRect();
    // The paper is rotated a hair; the bounding box is close enough at this angle.
    return { x: (e.clientX - b.left) / zoom, y: (e.clientY - b.top) / zoom };
  };
  const clamp = (r: RectView): RectView => {
    const w = Math.max(4, Math.min(r.w, page.width));
    const h = Math.max(4, Math.min(r.h, page.height));
    return { x: round(Math.max(0, Math.min(page.width - w, r.x))), y: round(Math.max(0, Math.min(page.height - h, r.y))), w: round(w), h: round(h) };
  };

  function onBackgroundDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || e.target !== overlayRef.current) return;
    const p = toPt(e);
    overlayRef.current!.setPointerCapture(e.pointerId);
    props.onSelect(null);
    setDrag({ kind: "draw", start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 }, lock: props.lockMode || e.shiftKey });
  }

  function onPatchDown(e: React.PointerEvent, patch: PatchView, handle?: Handle) {
    if (e.button !== 0) return;
    e.stopPropagation();
    overlayRef.current!.setPointerCapture(e.pointerId);
    props.onSelect(patch.id);
    const start = toPt(e);
    setDrag(
      handle
        ? { kind: "resize", id: patch.id, handle, start, origin: patch.rect, rect: patch.rect }
        : { kind: "move", id: patch.id, start, origin: patch.rect, rect: patch.rect },
    );
  }

  function onMove(e: React.PointerEvent) {
    if (!drag) return;
    const p = toPt(e);
    if (drag.kind === "draw") {
      const x = Math.min(p.x, drag.start.x);
      const y = Math.min(p.y, drag.start.y);
      setDrag({ ...drag, rect: { x, y, w: Math.abs(p.x - drag.start.x), h: Math.abs(p.y - drag.start.y) } });
      return;
    }
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.origin;
    if (drag.kind === "move") {
      setDrag({ ...drag, rect: clamp({ ...o, x: o.x + dx, y: o.y + dy }) });
      return;
    }
    let { x, y, w, h } = o;
    const hd = drag.handle;
    if (hd.includes("e")) w = o.w + dx;
    if (hd.includes("s")) h = o.h + dy;
    if (hd.includes("w")) {
      x = o.x + dx;
      w = o.w - dx;
    }
    if (hd.includes("n")) {
      y = o.y + dy;
      h = o.h - dy;
    }
    if (w < 4) {
      if (hd.includes("w")) x = o.x + o.w - 4;
      w = 4;
    }
    if (h < 4) {
      if (hd.includes("n")) y = o.y + o.h - 4;
      h = 4;
    }
    setDrag({ ...drag, rect: clamp({ x, y, w, h }) });
  }

  function onUp() {
    if (!drag) return;
    if (drag.kind === "draw") {
      if (drag.rect.w >= 3 && drag.rect.h >= 3) props.onDraw(clamp(drag.rect), drag.lock);
    } else {
      const r = drag.rect;
      const o = drag.origin;
      if (Math.abs(r.x - o.x) + Math.abs(r.y - o.y) + Math.abs(r.w - o.w) + Math.abs(r.h - o.h) > 0.4) {
        props.onRectCommit(drag.id, r);
      }
    }
    setDrag(null);
  }

  const patches = doc.patches.filter((p) => p.page === pageIndex);
  const locks = doc.locks.filter((l) => l.page === pageIndex);
  const suggestions = doc.suggestions.filter((s) => s.page === pageIndex && s.status === "open");

  return (
    <div className="rl-paper" style={{ width: W, height: H }}>
      {bytes ? (
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0" style={{ width: W, height: H, opacity: rendered ? 1 : 0.35 }} />
      ) : (
        <svg aria-label={t("reprint.wireframe")} className="absolute inset-0" width={W} height={H} viewBox={`0 0 ${page.width} ${page.height}`}>
          {(page.lines ?? []).map((l) => (
            <text
              key={l.id}
              className="rl-wire"
              x={l.x}
              y={l.y + ASCENT_RATIO * l.fontSize}
              fontSize={l.fontSize}
              fontWeight={l.bold ? 700 : 400}
              textLength={l.w}
              lengthAdjust="spacingAndGlyphs"
            >
              {l.text}
            </text>
          ))}
        </svg>
      )}

      <div
        ref={overlayRef}
        role="application"
        aria-label={props.lockMode ? t("reprint.lockModeHint") : t("reprint.markHint")}
        className={cn("absolute inset-0", props.lockMode ? "cursor-cell" : "cursor-crosshair")}
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {locks.map((lock) => (
          <div key={lock.id} className="rl-lock group pointer-events-none" style={toPx(lock.rect)} title={lock.label || t("reprint.lockedArea")}>
            <span className="pointer-events-auto absolute -top-5 left-0 flex items-center gap-1 whitespace-nowrap rounded bg-[var(--rl-lock)] px-1.5 py-0.5 text-[10px] font-medium leading-none text-white shadow-sm">
              <IconLock className="size-3" />
              <span className="max-w-32 truncate">{lock.label || t("reprint.lockedArea")}</span>
              <button
                type="button"
                className="ml-0.5 rounded-sm opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                aria-label={t("reprint.removeLock", { label: lock.label || t("reprint.lockedArea") })}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => props.onDeleteLock(lock)}
              >
                <IconX className="size-3" />
              </button>
            </span>
          </div>
        ))}

        {suggestions.map((s) => (
          <button
            key={s.id}
            type="button"
            className={cn("rl-suggestion", props.highlightSuggestionId === s.id && "ring-2 ring-[var(--rl-warn)] ring-offset-1")}
            style={toPx({ x: s.target.x - 1.5, y: s.target.y - 1.5, w: s.target.w + 3, h: s.target.h + 3 })}
            title={s.message}
            aria-label={s.message}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => props.onSuggestionClick(s)}
          />
        ))}

        {patches.map((patch) => {
          const live = drag && drag.kind !== "draw" && drag.id === patch.id ? drag.rect : patch.rect;
          return (
            <PatchBox
              key={patch.id}
              patch={patch}
              rect={live}
              zoom={zoom}
              mode={mode}
              label={props.labels.get(patch.id) ?? ""}
              selected={selectedId === patch.id}
              animate={props.animatingIds.has(patch.id)}
              onPointerDown={(e, handle) => onPatchDown(e, patch, handle)}
            />
          );
        })}

        {drag?.kind === "draw" ? <div className={cn("rl-draw", drag.lock && "rl-draw-lock")} style={toPx(drag.rect)} /> : null}
        {props.children?.(toPx)}
      </div>
    </div>
  );
}

const STATUS_COLOR = { ok: "var(--rl-ok)", warn: "var(--rl-warn)", error: "var(--rl-error)" } as const;

function PatchBox({
  patch,
  rect,
  zoom,
  mode,
  label,
  selected,
  animate,
  onPointerDown,
}: {
  patch: PatchView;
  rect: RectView;
  zoom: number;
  mode: "original" | "repaired";
  label: string;
  selected: boolean;
  animate: boolean;
  onPointerDown: (e: React.PointerEvent, handle?: Handle) => void;
}) {
  const repaired = mode === "repaired";
  const color = STATUS_COLOR[patch.status];
  const showOutline = !repaired || selected || patch.status === "error";
  const fs = patch.layout.fontSize;
  const scaleX = patch.layout.scaleX ?? 1;
  return (
    <div
      className={cn("rl-patch", animate && "rl-animate", repaired && "rl-label", selected ? "cursor-move" : "cursor-pointer")}
      style={{
        left: rect.x * zoom,
        top: rect.y * zoom,
        width: rect.w * zoom,
        height: rect.h * zoom,
        background: repaired ? patch.bgColor : "transparent",
        border: repaired && patch.border ? `${Math.max(0.5, 0.4 * zoom)}px solid #8c8c8c` : undefined,
        outline: showOutline ? `${selected ? 2 : 1.5}px ${repaired ? "solid" : "dashed"} ${color}` : undefined,
        outlineOffset: repaired ? 1 : 0,
        zIndex: selected ? 3 : 2,
      }}
      data-patch-id={patch.id}
      data-status={patch.status}
      onPointerDown={(e) => onPointerDown(e)}
    >
      {repaired
        ? patch.layout.lines.map((ln, i) => (
            <span
              key={i}
              className="rl-label-line"
              style={{
                left: ln.x * zoom,
                top: (ln.baseline - DEJAVU_ASCENT * fs) * zoom,
                fontSize: fs * zoom,
                fontFamily: FONT_CSS[patch.fontFamily],
                fontWeight: patch.bold ? 700 : 400,
                color: patch.textColor,
                transform: scaleX !== 1 ? `scaleX(${scaleX})` : undefined,
                transformOrigin: "left top",
              }}
            >
              {ln.text}
            </span>
          ))
        : null}
      {showOutline || selected ? (
        <span
          className="pointer-events-none absolute -top-4 left-0 flex items-center gap-1 rounded-sm px-1 text-[10px] font-semibold leading-4 text-white"
          style={{ background: color }}
        >
          {label}
        </span>
      ) : null}
      {selected
        ? HANDLES.map((h) => (
            <span
              key={h}
              className="rl-handle"
              style={{
                left: h.includes("w") ? -5 : h.includes("e") ? "calc(100% - 4px)" : "calc(50% - 4.5px)",
                top: h.includes("n") ? -5 : h.includes("s") ? "calc(100% - 4px)" : "calc(50% - 4.5px)",
                cursor: `${h}-resize`,
              }}
              onPointerDown={(e) => onPointerDown(e, h)}
            />
          ))
        : null}
    </div>
  );
}
