"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  CheckCheck,
  ExternalLink,
  Eye,
  PanelRightClose,
  Pin,
} from "lucide-react";
import type { CSSProperties } from "react";

import { CopyButton } from "@/features/issues-dashboard/components/copy-button";
import { IconActionButton } from "@/features/issues-dashboard/components/icon-action-button";
import { DraggableIssueCard } from "@/features/issues-dashboard/components/issue-card";
import { NotesBlockEditor } from "@/features/issues-dashboard/components/notes-block-editor";
import type {
  DashboardIssue,
  PriorityDefinition,
  PriorityValue,
} from "@/features/issues-dashboard/types";
import {
  getRemoteStateDotClassName,
} from "@/features/issues-dashboard/utils/dashboard-helpers";

interface PriorityBucket extends PriorityDefinition {
  issues: DashboardIssue[];
}

export interface ActiveBoardProps {
  activeIssue: DashboardIssue | null;
  backlogIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  priorityBuckets: PriorityBucket[];
  search?: string;
  selectedIssueKey: string | null;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCompleteIssue: (issueKey: string) => void;
  onReviewIssue: (issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onSearchChange?: (nextValue: string) => void;
  onSetPriority: (issueKey: string, priority: PriorityValue | null) => void;
  onTogglePin: (issueKey: string) => void;
  onUpdateBlocks: (
    issueKey: string,
    nextBlocks: DashboardIssue["localState"]["noteBlocks"],
  ) => void;
}

function DroppableBacklog({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: "bucket-null",
    data: { type: "Bucket", priority: null },
  });

  return (
    <section
      ref={setNodeRef}
      aria-label="Backlog"
      className={`${className ?? ""} ${
        isOver
          ? "bg-[rgb(var(--app-accent))]/10 border-[rgb(var(--app-accent))]/50"
          : ""
      }`}
    >
      {children}
    </section>
  );
}

function DroppablePriorityBucket({
  bucket,
  children,
}: {
  bucket: PriorityBucket;
  children: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `bucket-${String(bucket.value)}`,
    data: { type: "Bucket", priority: bucket.value },
  });

  const IconComponent = bucket.icon;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[160px] min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[rgb(var(--app-border))]/65 transition-colors ${
        isOver
          ? "bg-[rgb(var(--app-accent))]/10 border-[rgb(var(--app-accent))]/50"
          : "bg-[rgb(var(--app-surface-strong))]/88"
      }`}
    >
      <div
        className={`flex items-center justify-between gap-2 border-b border-[rgb(var(--app-border))]/55 px-3 py-2 text-xs font-semibold ${bucket.headerClassName}`}
      >
        <div className="inline-flex items-center gap-1.5">
          <IconComponent size={14} />
          <span>{bucket.label}</span>
        </div>
        <span className="rounded bg-[rgb(var(--app-surface))]/95 px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--app-muted))] shadow-xs">
          {bucket.issues.length}
        </span>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto p-2">
        <div className="space-y-2 pb-2">{children}</div>
      </div>
    </div>
  );
}

export function ActiveBoard({
  activeIssue,
  backlogIssues,
  isSidebarCollapsed,
  priorityBuckets,
  selectedIssueKey,
  onCollapseSidebar,
  onCompleteIssue,
  onIssueSelect,
  onReviewIssue,
  onSetPriority,
  onTogglePin,
  onUpdateBlocks,
}: ActiveBoardProps) {
  const sidebarIssue = activeIssue;
  const isSidebarVisible = Boolean(sidebarIssue && !isSidebarCollapsed);

  return (
    <div className="flex h-full min-h-0 min-w-0 gap-3">
      {/* 50/50 Quadrants Area - Backlog and Priority Matrix always split 50% / 50% */}
      <div className="grid flex-1 min-h-0 min-w-0 grid-cols-1 md:grid-cols-2 gap-3">
        {/* Quadrant 1: Backlog */}
        <DroppableBacklog className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
          <div className="border-b border-[rgb(var(--app-border))]/55 px-3.5 py-2.5 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                Backlog
              </h2>
              <span className="rounded-full bg-[rgb(var(--app-surface-strong))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--app-muted))] shadow-xs">
                {backlogIssues.length}
              </span>
            </div>
          </div>

          <div className="app-scrollbar min-h-0 flex-1 overflow-auto p-2.5">
            <div className="space-y-2 pb-2">
              {backlogIssues.length === 0 ? (
                <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/70 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
                  No hay issues en backlog para los filtros actuales.
                </div>
              ) : (
                backlogIssues.map((issue) => (
                  <DraggableIssueCard
                    key={issue.issueKey}
                    issue={issue}
                    onIssueSelect={onIssueSelect}
                    selectedIssueKey={selectedIssueKey}
                    onCompleteIssue={onCompleteIssue}
                    onReviewIssue={onReviewIssue}
                  />
                ))
              )}
            </div>
          </div>
        </DroppableBacklog>

        {/* Quadrant 2: Matriz de prioridades */}
        <section className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
          <div className="border-b border-[rgb(var(--app-border))]/55 px-3.5 py-2.5 shrink-0">
            <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
              Matriz de prioridades
            </h2>
          </div>

          <div className="grid min-h-0 flex-1 gap-2.5 p-2.5 md:grid-cols-2 md:grid-rows-2">
            {priorityBuckets.map((bucket) => (
              <DroppablePriorityBucket key={bucket.value} bucket={bucket}>
                {bucket.issues.length === 0 ? (
                  <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-6 text-center text-xs text-[rgb(var(--app-muted))]">
                    Arrastra aquí una issue priorizada.
                  </div>
                ) : (
                  bucket.issues.map((issue) => (
                    <DraggableIssueCard
                      key={issue.issueKey}
                      issue={issue}
                      onIssueSelect={onIssueSelect}
                      selectedIssueKey={selectedIssueKey}
                      onCompleteIssue={onCompleteIssue}
                      onReviewIssue={onReviewIssue}
                      onTogglePin={onTogglePin}
                    />
                  ))
                )}
              </DroppablePriorityBucket>
            ))}
          </div>
        </section>
      </div>

      {/* Detail Sidebar - Resizes smoothly beside the 50/50 main grid */}
      {isSidebarVisible && sidebarIssue ? (
        <aside className="flex w-[380px] lg:w-[440px] shrink-0 min-h-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96 shadow-md transition-all">
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
                  isDisabled={sidebarIssue.localState.priority === null}
                  label={
                    sidebarIssue.localState.isPinned
                      ? "Quitar fijado"
                      : "Fijar en el cuadrante"
                  }
                  onPress={() => onTogglePin(sidebarIssue.issueKey)}
                >
                  <Pin size={14} />
                </IconActionButton>
                <IconActionButton
                  label="Enviar a revisión"
                  className="!border-[#d97706]/50 !bg-[#d97706]/10 !text-[#d97706] hover:!bg-[#d97706]/20 hover:!border-[#d97706]/70"
                  onPress={() => onReviewIssue(sidebarIssue.issueKey)}
                >
                  <Eye size={14} />
                </IconActionButton>
                <IconActionButton
                  label="Completar localmente"
                  className="!border-[rgb(var(--app-open))]/50 !bg-[rgb(var(--app-open))]/10 !text-[rgb(var(--app-open))] hover:!bg-[rgb(var(--app-open))]/20 hover:!border-[rgb(var(--app-open))]/70"
                  onPress={() => onCompleteIssue(sidebarIssue.issueKey)}
                >
                  <CheckCheck size={14} />
                </IconActionButton>
                <button
                  type="button"
                  aria-label="Cerrar panel lateral"
                  className="flex h-8 w-8 items-center justify-center rounded-[0.8rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-surface-strong))] hover:text-[rgb(var(--app-foreground))]"
                  onClick={onCollapseSidebar}
                >
                  <PanelRightClose size={16} />
                </button>
              </div>
            </div>

            <h2 className="mt-2 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
              {sidebarIssue.title}
            </h2>
          </div>

          <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-3.5 py-3">
            <NotesBlockEditor
              blocks={sidebarIssue.localState.noteBlocks}
              onBlocksChange={(nextBlocks) =>
                onUpdateBlocks(sidebarIssue.issueKey, nextBlocks)
              }
            />
          </div>
        </aside>
      ) : null}
    </div>
  );
}
