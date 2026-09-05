"use client";

import { useDroppable } from "@dnd-kit/core";
import { CheckCheck, ExternalLink, Eye, List, Pin } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import { CopyButton } from "@/features/issues-dashboard/components/copy-button";
import { IconActionButton } from "@/features/issues-dashboard/components/icon-action-button";
import { DraggableIssueCard } from "@/features/issues-dashboard/components/issue-card";
import { IssuePrioritySelector } from "@/features/issues-dashboard/components/issue-priority-selector";
import { LinkedPullRequests } from "@/features/issues-dashboard/components/linked-pull-requests";
import { NotesBlockEditor } from "@/features/issues-dashboard/components/notes-block-editor";
import { ResizeHandle } from "@/features/issues-dashboard/components/resize-handle";
import type {
  DashboardIssue,
  PriorityDefinition,
  PriorityValue,
} from "@/features/issues-dashboard/types";
import { getRemoteStateDotClassName } from "@/features/issues-dashboard/utils/dashboard-helpers";

interface PriorityBucket extends PriorityDefinition {
  issues: DashboardIssue[];
}

export interface ActiveBoardProps {
  activeIssue: DashboardIssue | null;
  backlogIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  priorityBuckets: PriorityBucket[];
  selectedIssueKey: string | null;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCompleteIssue: (issueKey: string) => void;
  onReviewIssue: (issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onSetPriority: (issueKey: string, priority: PriorityValue | null) => void;
  onTogglePin: (issueKey: string) => void;
  onUpdateBlocks: (
    issueKey: string,
    nextBlocks: DashboardIssue["localState"]["noteBlocks"],
  ) => void;
}

type DragMode = "two-col" | "left-split" | "right-split";

interface DragState {
  mode: DragMode;
  startX: number;
  threeColumnLeft: number;
  threeColumnRight: number;
  twoColumnLeft: number;
}

const SPLITTER_WIDTH_PX = 10;
const TWO_COLUMN_MIN_LEFT = 18;
const TWO_COLUMN_MAX_LEFT = 34;
const THREE_COLUMN_MIN_LEFT = 16;
const THREE_COLUMN_MAX_LEFT = 28;
const THREE_COLUMN_MIN_CENTER = 38;
const THREE_COLUMN_MIN_RIGHT = 24;
const WIDE_LAYOUT_BREAKPOINT = 1280;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function getQuadrantHeaderStyle(definition: PriorityDefinition): CSSProperties {
  return {
    background: definition.tint,
    boxShadow: `inset 0 -1px 0 ${definition.tint}`,
    color: definition.color,
  };
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
      aria-label="Backlog de issues"
      className={`${className || ""} transition-colors ${isOver ? "bg-[rgb(var(--app-accent))]/5" : ""}`}
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
    id: `bucket-${bucket.value}`,
    data: { type: "Bucket", priority: bucket.value },
  });

  const BucketIcon = bucket.icon;

  return (
    <section
      ref={setNodeRef}
      aria-label={`Prioridad ${bucket.label}`}
      className={`flex min-h-[210px] min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[rgb(var(--app-border))]/65 transition-colors ${
        isOver
          ? "bg-[rgb(var(--app-accent))]/10 border-[rgb(var(--app-accent))]/50"
          : "bg-[rgb(var(--app-surface-strong))]/88"
      }`}
      style={{ borderTop: `4px solid ${bucket.color}` }}
    >
      <div
        className={`flex items-center justify-between gap-2 px-3 py-2.5 ${bucket.headerClassName}`}
        style={getQuadrantHeaderStyle(bucket)}
      >
        <div className="inline-flex items-center gap-2">
          <BucketIcon size={16} />
          <span className="text-sm font-semibold">{bucket.label}</span>
        </div>
        <span className="rounded bg-[rgb(var(--app-surface))]/95 px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--app-muted))]">
          {bucket.issues.length}
        </span>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="space-y-2 px-1 pb-2">{children}</div>
      </div>
    </section>
  );
}

export function ActiveBoard({
  activeIssue,
  backlogIssues,
  isSidebarCollapsed,
  priorityBuckets,
  selectedIssueKey,
  onCollapseSidebar,
  onExpandSidebar,
  onCompleteIssue,
  onReviewIssue,
  onIssueSelect,
  onSetPriority,
  onTogglePin,
  onUpdateBlocks,
}: ActiveBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(`(min-width: ${String(WIDE_LAYOUT_BREAKPOINT)}px)`)
      .matches;
  });
  const [twoColumnLeft, setTwoColumnLeft] = useState(24);
  const [threeColumnLeft, setThreeColumnLeft] = useState(20);
  const [threeColumnRight, setThreeColumnRight] = useState(30);

  const sidebarIssue = activeIssue;
  const isSidebarVisible = Boolean(sidebarIssue && !isSidebarCollapsed);

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${String(WIDE_LAYOUT_BREAKPOINT)}px)`,
    );
    const syncViewport = () => setIsWideLayout(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener("change", syncViewport);

    return () => mediaQuery.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    if (!dragState) {
      document.body.style.userSelect = "";
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const workspaceWidth = boardRef.current?.offsetWidth ?? 1;
      const deltaPercent =
        ((event.clientX - dragState.startX) / workspaceWidth) * 100;

      if (dragState.mode === "two-col") {
        setTwoColumnLeft(
          clamp(
            dragState.twoColumnLeft + deltaPercent,
            TWO_COLUMN_MIN_LEFT,
            TWO_COLUMN_MAX_LEFT,
          ),
        );
      }

      if (dragState.mode === "left-split") {
        const maxLeft = 100 - THREE_COLUMN_MIN_RIGHT - THREE_COLUMN_MIN_CENTER;
        setThreeColumnLeft(
          clamp(
            dragState.threeColumnLeft + deltaPercent,
            THREE_COLUMN_MIN_LEFT,
            Math.min(THREE_COLUMN_MAX_LEFT, maxLeft),
          ),
        );
      }

      if (dragState.mode === "right-split") {
        const maxRight = 100 - THREE_COLUMN_MIN_LEFT - THREE_COLUMN_MIN_CENTER;
        setThreeColumnRight(
          clamp(
            dragState.threeColumnRight - deltaPercent,
            THREE_COLUMN_MIN_RIGHT,
            maxRight,
          ),
        );
      }
    };

    const handleMouseUp = () => {
      setDragState(null);
    };

    const handleWindowBlur = () => {
      setDragState(null);
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget !== null) {
        return;
      }

      setDragState(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("mouseout", handleMouseOut);

    return () => {
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("mouseout", handleMouseOut);
    };
  }, [dragState]);

  const hasSidebarIssue = Boolean(sidebarIssue);
  const isSidebarExpanded = hasSidebarIssue && !isSidebarCollapsed;

  const wideLayoutColumns = isSidebarExpanded
    ? `${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(
        threeColumnLeft / 100,
      )})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(
        SPLITTER_WIDTH_PX,
      )}px ${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(
        threeColumnRight / 100,
      )})`}`
    : hasSidebarIssue
      ? `${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(
          twoColumnLeft / 100,
        )})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(
          SPLITTER_WIDTH_PX,
        )}px 0px`
      : `${`calc((100% - ${String(SPLITTER_WIDTH_PX)}px) * ${String(
          twoColumnLeft / 100,
        )})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr)`;

  const boardClassName = isWideLayout
    ? "grid h-full min-h-0"
    : "flex h-full min-h-0 flex-col gap-3";

  return (
    <div
      ref={boardRef}
      className={boardClassName}
      style={isWideLayout ? { gridTemplateColumns: wideLayoutColumns } : {}}
    >
      <DroppableBacklog className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
        <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex items-center gap-2">
              <List size={16} className="text-[rgb(var(--app-muted))]" />
              <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
                Backlog
              </h2>
            </div>
            <span className="rounded-full bg-[rgb(var(--app-surface-strong))] px-2 py-0.5 text-[11px] font-bold text-[rgb(var(--app-muted))]">
              {backlogIssues.length}
            </span>
          </div>
        </div>

        <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
          <div className="space-y-2 px-1 pb-2">
            {backlogIssues.length === 0 ? (
              <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/70 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
                No hay issues en backlog para la búsqueda actual.
              </div>
            ) : (
              backlogIssues.map((issue) => (
                <DraggableIssueCard
                  key={issue.issueKey}
                  isSelected={selectedIssueKey === issue.issueKey}
                  issue={issue}
                  onIssueSelect={onIssueSelect}
                  onCompleteIssue={onCompleteIssue}
                  onReviewIssue={onReviewIssue}
                />
              ))
            )}
          </div>
        </div>
      </DroppableBacklog>

      {isWideLayout ? (
        <ResizeHandle
          onPointerDown={(clientX) =>
            setDragState({
              mode: isSidebarVisible ? "left-split" : "two-col",
              startX: clientX,
              threeColumnLeft,
              threeColumnRight,
              twoColumnLeft,
            })
          }
        />
      ) : null}

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
        <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
          <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
            Matriz de prioridades
          </h2>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-2 md:grid-rows-2">
          {priorityBuckets.map((bucket) => (
            <DroppablePriorityBucket key={bucket.value} bucket={bucket}>
              {bucket.issues.length === 0 ? (
                <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
                  Arrastra aquí una issue priorizada.
                </div>
              ) : (
                bucket.issues.map((issue) => (
                  <DraggableIssueCard
                    key={issue.issueKey}
                    isSelected={selectedIssueKey === issue.issueKey}
                    issue={issue}
                    onIssueSelect={onIssueSelect}
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

      {hasSidebarIssue && isWideLayout ? (
        <ResizeHandle
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={
            isSidebarCollapsed ? onExpandSidebar : onCollapseSidebar
          }
          onPointerDown={
            isSidebarCollapsed
              ? undefined
              : (clientX) =>
                  setDragState({
                    mode: "right-split",
                    startX: clientX,
                    threeColumnLeft,
                    threeColumnRight,
                    twoColumnLeft,
                  })
          }
        />
      ) : null}

      {isSidebarExpanded && sidebarIssue ? (
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
          <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
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
              </div>
            </div>

            <h2 className="mt-1.5 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
              {sidebarIssue.title}
            </h2>
          </div>

          <LinkedPullRequests issue={sidebarIssue} />

          <IssuePrioritySelector
            issue={sidebarIssue}
            onSetPriority={onSetPriority}
          />

          <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-3 py-2.5">
            <NotesBlockEditor
              key={sidebarIssue.issueKey}
              blocks={sidebarIssue.localState.noteBlocks}
              onBlocksChange={(nextBlocks) =>
                onUpdateBlocks(sidebarIssue.issueKey, nextBlocks)
              }
            />
          </div>
        </aside>
      ) : !isWideLayout ? (
        <aside className="flex min-h-[220px] items-center justify-center rounded-[1.2rem] border border-dashed border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/78 px-5 py-8 text-center text-sm text-[rgb(var(--app-muted))] xl:min-h-0">
          Selecciona una issue para abrir el panel de contexto y notas.
        </aside>
      ) : null}
    </div>
  );
}
