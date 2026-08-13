"use client";

import { Button, Tooltip } from "@heroui/react";
import { Copy, Maximize2, Minus, X } from "lucide-react";

export interface DesktopTitleBarProps {
  className?: string;
  isMaximized?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
}

export function DesktopTitleBar({
  className,
  isMaximized,
  onClose,
  onMinimize,
  onToggleMaximize,
}: DesktopTitleBarProps) {
  const hasWindowControls = Boolean(onClose || onMinimize || onToggleMaximize);

  return (
    <div
      className={`[-webkit-app-region:drag] flex h-9 items-center justify-between rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 shadow-[0_10px_24px_-24px_rgba(0,0,0,0.35)] backdrop-blur ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--app-accent))]" />
        <p className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
          Issues Dashboard
        </p>
      </div>

      {hasWindowControls ? (
        <div className="[-webkit-app-region:no-drag] flex items-center gap-0.5">
          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label="Minimizar ventana"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-foreground))]/8 hover:text-[rgb(var(--app-foreground))]"
                  onPress={onMinimize}
                >
                  <Minus size={14} />
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>Minimizar</Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label={
                    isMaximized ? "Restaurar ventana" : "Maximizar ventana"
                  }
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-foreground))]/8 hover:text-[rgb(var(--app-foreground))]"
                  onPress={onToggleMaximize}
                >
                  {isMaximized ? <Copy size={14} /> : <Maximize2 size={14} />}
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>
              {isMaximized ? "Restaurar" : "Maximizar"}
            </Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label="Cerrar ventana"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-danger))] transition hover:bg-[rgb(var(--app-danger))]/12"
                  onPress={onClose}
                >
                  <X size={14} />
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>Cerrar</Tooltip.Content>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
