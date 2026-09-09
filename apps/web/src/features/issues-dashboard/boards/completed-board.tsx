"use client";

import { CheckCheck, ExternalLink, Eye, RotateCcw } from "lucide-react";
import { type CSSProperties, memo, useEffect, useRef, useState } from "react";

import { useIssueDropTarget } from "@/features/issues-dashboard/boards/issue-drop-target";
import { CopyButton } from "@/features/issues-dashboard/components/copy-button";
import { IconActionButton } from "@/features/issues-dashboard/components/icon-action-button";
import { DraggableIssueCard } from "@/features/issues-dashboard/components/issue-card";
import { IssuePrioritySelector } from "@/features/issues-dashboard/components/issue-priority-selector";
import { LinkedPullRequests } from "@/features/issues-dashboard/components/linked-pull-requests";
import {
  LinkedPullRequestsSkeleton,
  NotesEditorSkeleton,
} from "@/features/issues-dashboard/components/loading-skeletons";
import { NotesBlockEditor } from "@/features/issues-dashboard/components/notes-block-editor";
import { ResizeHandle } from "@/features/issues-dashboard/components/resize-handle";
import type {
  DashboardIssue,
  PriorityValue,
} from "@/features/issues-dashboard/types";
import {
  formatAbsoluteTimestamp,
  getRemoteStateDotClassName,
} from "@/features/issues-dashboard/utils/dashboard-helpers";

export interface CompletedBoardProps {
  activeIssue: DashboardIssue | null;
  completedIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  linkedPullRequestsCollapsed: boolean;
  reviewIssues: DashboardIssue[];
  selectedIssueKey: string | null;
  sidebarWidth: number;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onIssuePrefetch: (issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onSidebarWidthChange: (width: number) => void;
  onRestoreIssue: (issueKey: string) => void;
  onSetPriority: (issueKey: string, priority: PriorityValue | null) => void;
  onReviewIssue?: (issueKey: string) => void;
  onCompleteIssue?: (issueKey: string) => void;
  onUpdateBlocks: (
    issueKey: string,
    nextBlocks: DashboardIssue["localState"]["noteBlocks"],
  ) => void;
}

function DroppableBucket({
  bucketId,
  children,
  count,
  headerBgStyle,
  icon: IconComponent,
  title,
}: {
  bucketId: string;
  children: React.ReactNode;
  count: number;
  headerBgStyle?: CSSProperties;
  icon: React.ElementType;
  title: string;
}) {
  const { isOver, setRegionRef, setContentRef } = useIssueDropTarget(
    `bucket-${bucketId}`,
    bucketId,
  );

  return (
    <section
      ref={setRegionRef}
      aria-label={title}
      className={`flex h-full min-h-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 transition-colors ${
        isOver
          ? "bg-[rgb(var(--app-accent))]/10 border-[rgb(var(--app-accent))]/50"
          : "bg-[rgb(var(--app-surface))]/96"
      }`}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-[rgb(var(--app-border))]/55 px-3.5 py-2.5 shrink-0"
        style={headerBgStyle}
      >
        <div className="inline-flex items-center gap-2">
          <IconComponent size={16} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <span className="rounded-full bg-[rgb(var(--app-surface))]/95 px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--app-muted))] shadow-xs">
          {count}
        </span>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto p-2.5">
        <div ref={setContentRef} className="space-y-2 pb-2">
          {children}
        </div>
      </div>
    </section>
  );
}

export const CompletedBoard = memo(function CompletedBoard({
  activeIssue,
  completedIssues,
  isSidebarCollapsed,
  linkedPullRequestsCollapsed,
  reviewIssues,
  selectedIssueKey,
  sidebarWidth,
  onCollapseSidebar,
  onExpandSidebar,
  onIssuePrefetch,
  onIssueSelect,
  onSidebarWidthChange,
  onRestoreIssue,
  onSetPriority,
  onReviewIssue,
  onCompleteIssue,
  onUpdateBlocks,
}: CompletedBoardProps) {
  const sidebarIssue = activeIssue;
  const [renderedSidebarWidth, setRenderedSidebarWidth] =
    useState(sidebarWidth);
  const sidebarWidthRef = useRef(sidebarWidth);
  const [dragState, setDragState] = useState<{
    startX: number;
    startWidth: number;
  } | null>(null);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
    setRenderedSidebarWidth(sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    if (!dragState) {
      document.body.style.userSelect = "";
      return;
    }

    document.body.style.userSelect = "none";

    const handleMouseMove = (event: MouseEvent) => {
      const delta = dragState.startX - event.clientX;
      const nextWidth = Math.min(
        960,
        Math.max(320, dragState.startWidth + delta),
      );
      sidebarWidthRef.current = nextWidth;
      setRenderedSidebarWidth(nextWidth);
    };

    const handleMouseUp = () => {
      onSidebarWidthChange(Math.round(sidebarWidthRef.current));
      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, onSidebarWidthChange]);

  return (
    <div
      className={`flex h-full min-h-0 min-w-0 ${sidebarIssue ? "gap-0" : "gap-3"}`}
    >
      <div className="grid flex-1 min-h-0 min-w-0 grid-cols-1 md:grid-cols-2 gap-3">
        <DroppableBucket
          bucketId="review"
          count={reviewIssues.length}
          icon={Eye}
          title="En revisión"
          headerBgStyle={{
            background: "rgba(217, 119, 6, 0.12)",
            color: "#d97706",
          }}
        >
          {reviewIssues.length === 0 ? (
            <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
              No hay issues en revisión.
            </div>
          ) : (
            reviewIssues.map((issue) => (
              <DraggableIssueCard
                key={issue.issueKey}
                isSelected={selectedIssueKey === issue.issueKey}
                issue={issue}
                onIssuePrefetch={onIssuePrefetch}
                onIssueSelect={onIssueSelect}
                onCompleteIssue={onCompleteIssue}
                onRestoreIssue={onRestoreIssue}
              />
            ))
          )}
        </DroppableBucket>

        <DroppableBucket
          bucketId="completed"
          count={completedIssues.length}
          icon={CheckCheck}
          title="Completadas localmente"
          headerBgStyle={{
            background: "rgba(34, 197, 94, 0.12)",
            color: "rgb(var(--app-open))",
          }}
        >
          {completedIssues.length === 0 ? (
            <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
              No hay issues completadas localmente.
            </div>
          ) : (
            completedIssues.map((issue) => (
              <DraggableIssueCard
                key={issue.issueKey}
                isSelected={selectedIssueKey === issue.issueKey}
                issue={issue}
                onIssuePrefetch={onIssuePrefetch}
                onIssueSelect={onIssueSelect}
                onRestoreIssue={onRestoreIssue}
                onReviewIssue={onReviewIssue}
              />
            ))
          )}
        </DroppableBucket>
      </div>

      {sidebarIssue ? (
        <ResizeHandle
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={
            isSidebarCollapsed ? onExpandSidebar : onCollapseSidebar
          }
          onPointerDown={
            isSidebarCollapsed
              ? undefined
              : (clientX) => {
                  setDragState({
                    startX: clientX,
                    startWidth: renderedSidebarWidth,
                  });
                }
          }
        />
      ) : null}

      {!isSidebarCollapsed && sidebarIssue ? (
        <aside
          style={{ width: `${String(renderedSidebarWidth)}px` }}
          className="shrink-0 min-h-0 flex flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96 shadow-md transition-all"
        >
          <div className="border-b border-[rgb(var(--app-border))]/55 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] text-[rgb(var(--app-muted))]">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="min-w-0 truncate font-medium text-[rgb(var(--app-foreground))]">
                  {sidebarIssue.repository.fullName}
                </span>
                <span>#{sidebarIssue.number}</span>
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 rounded-full ${getRemoteStateDotClassName(sidebarIssue.remoteState)}`}
                />
              </div>

              <div className="ml-auto flex shrink-0 items-center gap-1">
                <CopyButton
                  url={sidebarIssue.htmlUrl}
                  iconSize={14}
                  persistsOnCopy
                  tooltipDelay={120}
                  className="h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none transition hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))]"
                />
                <IconActionButton
                  label="Abrir en GitHub"
                  onPress={() =>
                    window.open(
                      sidebarIssue.htmlUrl,
                      "_blank",
                      "noopener,noreferrer",
                    )
                  }
                >
                  <ExternalLink size={14} />
                </IconActionButton>
                <IconActionButton
                  label="Restaurar al dashboard"
                  onPress={() => onRestoreIssue(sidebarIssue.issueKey)}
                >
                  <RotateCcw size={14} />
                </IconActionButton>
              </div>
            </div>

            <h2 className="mt-2 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
              {sidebarIssue.title}
            </h2>

            {sidebarIssue.localState.localCompletedAt ? (
              <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                Completada el{" "}
                {formatAbsoluteTimestamp(
                  sidebarIssue.localState.localCompletedAt,
                )}
              </p>
            ) : null}
          </div>

          {sidebarIssue.detailsLoaded ? (
            <LinkedPullRequests
              defaultCollapsed={linkedPullRequestsCollapsed}
              issue={sidebarIssue}
            />
          ) : (
            <LinkedPullRequestsSkeleton />
          )}

          <IssuePrioritySelector
            issue={sidebarIssue}
            onSetPriority={onSetPriority}
          />

          {sidebarIssue.detailsLoaded ? (
            <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-3.5 py-3">
              <NotesBlockEditor
                key={sidebarIssue.issueKey}
                blocks={sidebarIssue.localState.noteBlocks}
                onBlocksChange={(nextBlocks) =>
                  onUpdateBlocks(sidebarIssue.issueKey, nextBlocks)
                }
              />
            </div>
          ) : (
            <NotesEditorSkeleton />
          )}
        </aside>
      ) : null}
    </div>
  );
});
