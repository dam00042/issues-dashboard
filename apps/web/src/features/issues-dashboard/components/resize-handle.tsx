"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";

export interface ResizeHandleProps {
  isCollapsed?: boolean;
  onPointerDown?: (clientX: number) => void;
  onToggleCollapse?: () => void;
}

export function ResizeHandle({
  isCollapsed,
  onPointerDown,
  onToggleCollapse,
}: ResizeHandleProps) {
  return (
    <div
      className={`relative hidden items-stretch justify-center xl:flex ${
        onPointerDown ? "cursor-col-resize" : ""
      }`}
    >
      <button
        aria-label={onPointerDown ? "Redimensionar paneles" : "Separador"}
        className={`flex w-[10px] items-center justify-center ${
          onPointerDown ? "cursor-col-resize" : "cursor-default"
        }`}
        onMouseDown={(event) => onPointerDown?.(event.clientX)}
        type="button"
        disabled={!onPointerDown}
      >
        <div
          className={`h-full w-px rounded-full transition-colors ${
            onPointerDown
              ? "bg-[rgb(var(--app-border))]/80 hover:bg-[rgb(var(--app-accent))]"
              : "bg-[rgb(var(--app-border))]/50"
          }`}
        />
      </button>
      {onToggleCollapse ? (
        <button
          type="button"
          aria-label={
            isCollapsed ? "Mostrar panel lateral" : "Ocultar panel lateral"
          }
          className={`absolute top-1/2 -translate-y-1/2 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))] text-[rgb(var(--app-muted))] shadow-md transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-foreground))] ${
            isCollapsed ? "-left-3" : ""
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          {isCollapsed ? (
            <PanelRightOpen size={12} />
          ) : (
            <PanelRightClose size={12} />
          )}
        </button>
      ) : null}
    </div>
  );
}
