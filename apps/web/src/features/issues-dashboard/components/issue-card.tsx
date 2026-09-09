"use client";

import { DragOverlay, useDndMonitor, useDraggable } from "@dnd-kit/core";
import { Button, Tooltip } from "@heroui/react";
import {
  CheckCheck,
  ExternalLink,
  Eye,
  NotebookText,
  Pin,
  RotateCcw,
} from "lucide-react";
import { memo, useState } from "react";

import { CopyButton } from "@/features/issues-dashboard/components/copy-button";
import type { DashboardIssue } from "@/features/issues-dashboard/types";
import {
  formatRelativeTimestamp,
  getRemoteStateDotClassName,
  hasMeaningfulNotes,
} from "@/features/issues-dashboard/utils/dashboard-helpers";

export interface IssueCardProps {
  isDragging?: boolean;
  isSelected: boolean;
  issue: DashboardIssue;
  onIssuePrefetch?: (issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onCompleteIssue?: (issueKey: string) => void;
  onReviewIssue?: (issueKey: string) => void;
  onRestoreIssue?: (issueKey: string) => void;
  onTogglePin?: (issueKey: string) => void;
  style?: React.CSSProperties;
}

export const IssueCard = memo(function IssueCard({
  isDragging,
  isSelected,
  issue,
  onIssuePrefetch,
  onIssueSelect,
  onCompleteIssue,
  onReviewIssue,
  onRestoreIssue,
  onTogglePin,
  style,
}: IssueCardProps) {
  const [showActions, setShowActions] = useState(false);

  return (
    // A button cannot contain the card's independent action buttons.
    // biome-ignore lint/a11y/useSemanticElements: this composite card has keyboard handling and nested controls.
    <div
      role="button"
      tabIndex={0}
      style={style}
      className={`issue-card relative w-full cursor-pointer rounded-[0.9rem] border px-2.5 py-3 text-left transition-[border-color,background-color,box-shadow,opacity] duration-75 hover:border-[rgb(var(--app-accent))]/45 hover:bg-[rgb(var(--app-accent))]/4 active:cursor-grabbing ${
        isDragging
          ? "border-[rgb(var(--app-accent))]/55 bg-[rgb(var(--app-surface))] opacity-90 shadow-[0_18px_34px_-22px_rgba(0,0,0,0.5)]"
          : ""
      } ${
        isSelected
          ? "border-[rgb(var(--app-accent))]/65 bg-[rgb(var(--app-accent))]/8"
          : "border-[rgb(var(--app-border))]/65 bg-[rgb(var(--app-surface))]/94"
      }`}
      onClick={(event) => {
        if ((event.target as Element).closest("button, a")) return;
        onIssueSelect(issue.issueKey);
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") onIssueSelect(issue.issueKey);
      }}
      onFocusCapture={() => setShowActions(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setShowActions(false);
        }
      }}
      onPointerEnter={() => {
        setShowActions(true);
        onIssuePrefetch?.(issue.issueKey);
      }}
      onPointerLeave={() => setShowActions(false)}
    >
      <div
        aria-hidden
        className="absolute right-2.5 top-2.5 flex h-2 items-center gap-1.5"
      >
        {issue.localState.isPinned ? (
          <Pin size={11} className="text-[rgb(var(--app-muted))]" />
        ) : null}
        <span
          className={`shrink-0 h-2 w-2 rounded-full ${getRemoteStateDotClassName(issue.remoteState)}`}
        />
      </div>

      {showActions && !isDragging ? (
        <div
          className="issue-card-actions absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CopyButton url={issue.htmlUrl} iconSize={11} />

          <Tooltip closeDelay={0} delay={80}>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  size="sm"
                  variant="outline"
                  className="h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]"
                  onPress={() =>
                    window.open(issue.htmlUrl, "_blank", "noopener,noreferrer")
                  }
                >
                  <ExternalLink size={11} className="!size-[11px]" />
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>Abrir en GitHub</Tooltip.Content>
          </Tooltip>

          {onTogglePin ? (
            <Tooltip closeDelay={0} delay={80}>
              <Tooltip.Trigger>
                <div className="inline-flex">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="outline"
                    className={`h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))] ${issue.localState.isPinned ? "border-[rgb(var(--app-accent))]/40 text-[rgb(var(--app-foreground))]" : ""}`}
                    onPress={() => onTogglePin(issue.issueKey)}
                  >
                    <Pin
                      size={11}
                      className={`!size-[11px] ${issue.localState.isPinned ? "fill-current" : ""}`}
                    />
                  </Button>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>
                {issue.localState.isPinned ? "Desfijar" : "Fijar"}
              </Tooltip.Content>
            </Tooltip>
          ) : null}

          {onReviewIssue ? (
            <Tooltip closeDelay={0} delay={80}>
              <Tooltip.Trigger>
                <div className="inline-flex">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="outline"
                    className="h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[#d97706]/50 bg-[rgb(var(--app-surface-strong))]/95 text-[#d97706] shadow-sm hover:bg-[#d97706]/15"
                    onPress={() => onReviewIssue(issue.issueKey)}
                  >
                    <Eye size={11} className="!size-[11px]" />
                  </Button>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>Mandar a revisión</Tooltip.Content>
            </Tooltip>
          ) : null}

          {onCompleteIssue ? (
            <Tooltip closeDelay={0} delay={80}>
              <Tooltip.Trigger>
                <div className="inline-flex">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="outline"
                    className="h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[rgb(var(--app-open))]/50 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-open))] shadow-sm hover:bg-[rgb(var(--app-open))]/15"
                    onPress={() => onCompleteIssue(issue.issueKey)}
                  >
                    <CheckCheck size={11} className="!size-[11px]" />
                  </Button>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>Completar localmente</Tooltip.Content>
            </Tooltip>
          ) : null}

          {onRestoreIssue ? (
            <Tooltip closeDelay={0} delay={80}>
              <Tooltip.Trigger>
                <div className="inline-flex">
                  <Button
                    isIconOnly
                    size="sm"
                    variant="outline"
                    className="h-[22px] w-[22px] min-w-[22px] rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]"
                    onPress={() => onRestoreIssue(issue.issueKey)}
                  >
                    <RotateCcw size={11} className="!size-[11px]" />
                  </Button>
                </div>
              </Tooltip.Trigger>
              <Tooltip.Content showArrow>
                Restaurar al dashboard
              </Tooltip.Content>
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      <div className="pr-4 text-[0.61rem] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--app-muted))]">
        {issue.repository.name} #{issue.number}
      </div>

      <p className="mt-1 line-clamp-2 text-[0.84rem] font-medium leading-5 text-[rgb(var(--app-foreground))]">
        {issue.title}
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-[rgb(var(--app-muted))]">
        <span className="truncate">
          Actualizada {formatRelativeTimestamp(issue.updatedAt)}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {hasMeaningfulNotes(issue.localState.noteBlocks) ? (
            <NotebookText size={11} />
          ) : null}
        </div>
      </div>
    </div>
  );
});

const DRAG_OVERLAY_STYLE: React.CSSProperties = {
  pointerEvents: "none",
  willChange: "transform",
};

const IssueDragPreview = memo(function IssueDragPreview({
  issue,
}: {
  issue: DashboardIssue;
}) {
  return (
    <div className="relative w-full rounded-[0.9rem] border border-[rgb(var(--app-accent))]/55 bg-[rgb(var(--app-surface))] px-2.5 py-3 text-left opacity-90 shadow-[0_18px_34px_-22px_rgba(0,0,0,0.5)]">
      <div
        aria-hidden
        className="absolute right-2.5 top-2.5 flex h-2 items-center gap-1.5"
      >
        {issue.localState.isPinned ? (
          <Pin size={11} className="text-[rgb(var(--app-muted))]" />
        ) : null}
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${getRemoteStateDotClassName(issue.remoteState)}`}
        />
      </div>

      <div className="pr-4 text-[0.61rem] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--app-muted))]">
        {issue.repository.name} #{issue.number}
      </div>

      <p className="mt-1 line-clamp-2 text-[0.84rem] font-medium leading-5 text-[rgb(var(--app-foreground))]">
        {issue.title}
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-[rgb(var(--app-muted))]">
        <span className="truncate">
          Actualizada {formatRelativeTimestamp(issue.updatedAt)}
        </span>
        {hasMeaningfulNotes(issue.localState.noteBlocks) ? (
          <NotebookText size={11} />
        ) : null}
      </div>
    </div>
  );
});

export function IssueDragOverlay() {
  const [draggedIssue, setDraggedIssue] = useState<DashboardIssue | null>(null);

  useDndMonitor({
    onDragStart({ active }) {
      setDraggedIssue((active.data.current?.issue as DashboardIssue) ?? null);
    },
    onDragCancel() {
      setDraggedIssue(null);
    },
    onDragEnd() {
      setDraggedIssue(null);
    },
  });

  return (
    <DragOverlay dropAnimation={null} style={DRAG_OVERLAY_STYLE}>
      {draggedIssue ? <IssueDragPreview issue={draggedIssue} /> : null}
    </DragOverlay>
  );
}

export const DraggableIssueCard = memo(function DraggableIssueCard(
  props: IssueCardProps,
) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: props.issue.issueKey,
    data: { issue: props.issue },
  });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className="touch-none">
      <IssueCard {...props} isDragging={isDragging} />
    </div>
  );
});
