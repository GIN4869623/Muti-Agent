"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

type Position = { x: number; y: number };
type Drag = Position & { pointerId: number; clientX: number; clientY: number };
const EDGE = 8;

function readPosition(key: string): Position | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && typeof saved === "object" && "x" in saved && "y" in saved &&
        typeof saved.x === "number" && Number.isFinite(saved.x) &&
        typeof saved.y === "number" && Number.isFinite(saved.y)) {
      return { x: saved.x, y: saved.y };
    }
  } catch { /* In-memory positioning still works when browser storage is unavailable. */ }
  return null;
}

export function useDraggablePanel(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
  storageKey: string,
) {
  const position = useRef<Position | null>(null);
  const drag = useRef<Drag | null>(null);

  const savePosition = useCallback(() => {
    if (!position.current) return;
    try { localStorage.setItem(storageKey, JSON.stringify(position.current)); }
    catch { /* Closing and reopening still uses the position held in memory. */ }
  }, [storageKey]);

  const placePanel = useCallback((next: Position) => {
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const maxX = Math.max(EDGE, document.documentElement.clientWidth - rect.width - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - rect.height - EDGE);
    const point = {
      x: Math.round(Math.max(EDGE, Math.min(next.x, maxX))),
      y: Math.round(Math.max(EDGE, Math.min(next.y, maxY))),
    };
    // Only the independent floating panel moves; React owns its contents as usual.
    panel.style.left = `${point.x}px`;
    panel.style.top = `${point.y}px`;
    panel.style.right = "auto";
    position.current = point;
  }, [panelRef]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel) return;
    const rect = panel.getBoundingClientRect();
    placePanel(position.current ?? readPosition(storageKey) ?? { x: rect.left, y: rect.top });
    const keepVisible = () => {
      if (position.current) placePanel(position.current);
    };
    // Content, tab changes, textarea resizing, and viewport changes can alter bounds.
    const observer = new ResizeObserver(keepVisible);
    observer.observe(panel);
    window.addEventListener("resize", keepVisible);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", keepVisible);
      drag.current = null;
      savePosition();
    };
  }, [open, panelRef, placePanel, savePosition, storageKey]);

  const finishDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    panelRef.current?.removeAttribute("data-dragging");
    savePosition();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [panelRef, savePosition]);

  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary || !position.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      drag.current = {
        ...position.current,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      panelRef.current?.setAttribute("data-dragging", "true");
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      placePanel({
        x: start.x + event.clientX - start.clientX,
        y: start.y + event.clientY - start.clientY,
      });
    },
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onLostPointerCapture: finishDrag,
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
      const point = position.current;
      if (!point) return;
      const distance = event.shiftKey ? 20 : 5;
      const offsets: Record<string, Position> = {
        ArrowLeft: { x: -distance, y: 0 }, ArrowRight: { x: distance, y: 0 },
        ArrowUp: { x: 0, y: -distance }, ArrowDown: { x: 0, y: distance },
      };
      const offset = offsets[event.key];
      if (!offset) return;
      event.preventDefault();
      placePanel({ x: point.x + offset.x, y: point.y + offset.y });
      savePosition();
    },
  };
}
