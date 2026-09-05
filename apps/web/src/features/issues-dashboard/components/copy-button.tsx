"use client";

import { Button, Tooltip } from "@heroui/react";
import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export interface CopyButtonProps {
  url: string;
  className?: string;
  iconSize?: number;
  persistsOnCopy?: boolean;
  tooltipDelay?: number;
}

export function CopyButton({
  url,
  className = "h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]",
  iconSize = 10,
  persistsOnCopy = false,
  tooltipDelay = 80,
}: CopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = useCallback(
    (e?: React.MouseEvent | unknown) => {
      if (e && typeof (e as Event).stopPropagation === "function") {
        (e as Event).stopPropagation();
      }

      void navigator.clipboard.writeText(url);
      setIsCopied(true);

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    },
    [url],
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open && !persistsOnCopy) {
      setIsCopied(false);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    }
  };

  const tooltipIsOpen = (persistsOnCopy && isCopied) || isOpen;

  return (
    <Tooltip
      key={isCopied ? "copied" : "normal"}
      closeDelay={0}
      delay={tooltipDelay}
      isOpen={tooltipIsOpen ? true : undefined}
      onOpenChange={handleOpenChange}
    >
      <Tooltip.Trigger>
        <div className="inline-flex">
          <Button
            isIconOnly
            size="sm"
            variant="outline"
            className={className}
            onPress={handleCopy}
          >
            {isCopied ? (
              <Check
                size={iconSize}
                style={{ height: iconSize, width: iconSize }}
                className="text-[rgb(var(--app-open))]"
              />
            ) : (
              <Copy
                size={iconSize}
                style={{ height: iconSize, width: iconSize }}
              />
            )}
          </Button>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content
        showArrow
        className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]"
      >
        {isCopied ? "¡Copiado!" : "Copiar URL"}
      </Tooltip.Content>
    </Tooltip>
  );
}
