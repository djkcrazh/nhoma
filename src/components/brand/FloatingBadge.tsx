"use client";

import { useRef, useState } from "react";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * The one draggable element in the app: a Nhoma badge anchored in the sidebar's
 * bottom-left, sitting just above the "NHOMA V1" footer. Grab it and it follows
 * the pointer; let go and it springs back to its home position. Hidden on the
 * mobile bottom-nav layout (< 560px) where the sidebar isn't shown.
 */
export function FloatingBadge() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const start = useRef({ x: 0, y: 0 });

  return (
    <button
      type="button"
      aria-label="Nhoma"
      className="fixed bottom-14 left-3.5 z-40 hidden h-11 w-11 cursor-grab touch-none select-none items-center justify-center rounded-full border border-rule bg-sunken text-ink active:cursor-grabbing min-[560px]:flex"
      style={{
        transform: `translate(${offset.x}px, ${offset.y}px)`,
        transition: dragging ? "none" : "transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
        boxShadow: "var(--shadow)",
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* pointer capture is a nicety, not required for dragging */
        }
        start.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        setOffset({ x: e.clientX - start.current.x, y: e.clientY - start.current.y });
      }}
      onPointerUp={(e) => {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* no-op */
        }
        setDragging(false);
        setOffset({ x: 0, y: 0 });
      }}
    >
      <BrandMark bare size={22} />
    </button>
  );
}
