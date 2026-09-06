"use client";

import { Button, Tooltip } from "@heroui/react";
import { type ReactNode, useState } from "react";

export interface IconActionButtonProps {
  children: ReactNode;
  className?: string;
  isDisabled?: boolean;
  isOpen?: boolean;
  label: string;
  onPress?: () => void;
  onOpenChange?: (isOpen: boolean) => void;
}

export function IconActionButton({
  children,
  className,
  isDisabled = false,
  isOpen: forcedIsOpen,
  label,
  onPress,
  onOpenChange: customOnOpenChange,
}: IconActionButtonProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    customOnOpenChange?.(nextOpen);
  };

  return (
    <Tooltip
      closeDelay={0}
      delay={120}
      isOpen={forcedIsOpen || isOpen}
      onOpenChange={handleOpenChange}
    >
      <Tooltip.Trigger>
        <div className="inline-flex">
          <Button
            isIconOnly
            size="sm"
            variant="outline"
            isDisabled={isDisabled}
            className={`h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none transition hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))] ${className ?? ""}`}
            onPress={onPress}
          >
            {children}
          </Button>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content
        showArrow
        className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]"
      >
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}
