"use client";

import { Button, Tooltip } from "@heroui/react";
import {
  CheckCheck,
  Copy,
  ExternalLink,
  Eye,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  RotateCcw,
} from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";

import { IconActionButton } from "@/features/issues-dashboard/dashboard-chrome";
import {
  formatAbsoluteTimestamp,
  hasMeaningfulNotes,
} from "@/features/issues-dashboard/dashboard-helpers";
import { NotesBlockEditor } from "@/features/issues-dashboard/notes-block-editor";
import type { DashboardIssue } from "@/features/issues-dashboard/types";

// ─── Column definitions ────────────────────────────────────────────────────────

interface ColumnDef {
  color: string;
  emptyLabel: string;
  icon: typeof Eye;
  label: string;
  tint: string;
}

const REVIEW_COLUMN: ColumnDef = {
  color: "#d97706",
  emptyLabel: "No hay issues en revisión todavía.",
  icon: Eye,
  label: "En revisión",
  tint: "rgba(217,119,6,0.08)",
};

const COMPLETED_COLUMN: ColumnDef = {
  color: "rgb(var(--app-open))",
  emptyLabel: "No hay issues completadas todavía.",
  icon: CheckCheck,
  label: "Completadas",
  tint: "rgba(var(--app-open),0.07)",
};

// ─── Layout constants ──────────────────────────────────────────────────────────

const SPLITTER_WIDTH_PX = 10;
const TWO_COLUMN_MIN_LEFT = 30;
const TWO_COLUMN_MAX_LEFT = 70;
const THREE_COLUMN_MIN_LEFT = 22;
const THREE_COLUMN_MAX_LEFT = 42;
const THREE_COLUMN_MIN_CENTER = 32;
const THREE_COLUMN_MIN_RIGHT = 20;
const WIDE_LAYOUT_BREAKPOINT = 1280;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function getRemoteStateDotClassName(
  remoteState: DashboardIssue["remoteState"],
): string {
  return remoteState === "open"
    ? "bg-[rgb(var(--app-open))]"
    : "bg-[rgb(var(--app-closed))]";
}

function getColumnHeaderStyle(column: ColumnDef): CSSProperties {
  return {
    background: column.tint,
    boxShadow: `inset 0 -1px 0 ${column.tint}`,
    color: column.color,
  };
}

// ─── ResizeHandle ──────────────────────────────────────────────────────────────

function ResizeHandle({
  isCollapsed,
  onPointerDown,
  onToggleCollapse,
}: {
  isCollapsed?: boolean;
  onPointerDown?: (clientX: number) => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <div className={`relative hidden items-stretch justify-center xl:flex ${onPointerDown ? "cursor-col-resize" : ""}`}>
      <button
        aria-label={onPointerDown ? "Redimensionar paneles" : "Separador"}
        className={`flex w-[10px] items-center justify-center ${onPointerDown ? "cursor-col-resize" : "cursor-default"}`}
        onMouseDown={(event) => onPointerDown?.(event.clientX)}
        type="button"
        disabled={!onPointerDown}
      >
        <div className={`h-full w-px rounded-full transition-colors ${onPointerDown ? "bg-[rgb(var(--app-border))]/80 hover:bg-[rgb(var(--app-accent))]" : "bg-[rgb(var(--app-border))]/50"}`} />
      </button>
      {onToggleCollapse ? (
        <button
          type="button"
          aria-label={isCollapsed ? "Mostrar panel lateral" : "Ocultar panel lateral"}
          className={`absolute top-1/2 -translate-y-1/2 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))] text-[rgb(var(--app-muted))] shadow-md transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-foreground))] ${isCollapsed ? "-left-3" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          {isCollapsed ? <PanelRightOpen size={12} /> : <PanelRightClose size={12} />}
        </button>
      ) : null}
    </div>
  );
}

// ─── IssueCard ─────────────────────────────────────────────────────────────────

const IssueCard = memo(function IssueCard({
  isDragging,
  issue,
  selectedIssueKey,
  onIssueDragEnd,
  onIssueDragStart,
  onIssueSelect,
  onRestoreIssue,
}: {
  isDragging: boolean;
  issue: DashboardIssue;
  selectedIssueKey: string | null;
  onIssueDragEnd: () => void;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
}) {
  return (
    <button
      type="button"
      className={`group relative w-full cursor-pointer rounded-[0.9rem] border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow,transform,opacity] duration-75 will-change-transform hover:border-[rgb(var(--app-accent))]/45 hover:bg-[rgb(var(--app-accent))]/4 active:cursor-grabbing ${
        isDragging
          ? "border-[rgb(var(--app-accent))]/55 bg-[rgb(var(--app-surface))] opacity-90 shadow-[0_18px_34px_-22px_rgba(0,0,0,0.5)]"
          : ""
      } ${
        selectedIssueKey === issue.issueKey
          ? "border-[rgb(var(--app-accent))]/65 bg-[rgb(var(--app-accent))]/8"
          : "border-[rgb(var(--app-border))]/65 bg-[rgb(var(--app-surface))]/94"
      }`}
      draggable
      onClick={() => onIssueSelect(issue.issueKey)}
      onDragEnd={onIssueDragEnd}
      onDragStart={(event) => onIssueDragStart(event, issue.issueKey)}
    >
      <span
        aria-hidden
        className={`absolute right-2.5 top-2.5 h-2 w-2 rounded-full ${getRemoteStateDotClassName(issue.remoteState)}`}
      />

      <div
        className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Tooltip closeDelay={0} delay={80}>
          <Tooltip.Trigger>
            <div className="inline-flex">
              <Button
                isIconOnly
                size="sm"
                variant="outline"
                className="h-6 w-6 min-w-6 rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]"
                onPress={() => void navigator.clipboard.writeText(issue.htmlUrl)}
              >
                <Copy size={11} />
              </Button>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>Copiar URL</Tooltip.Content>
        </Tooltip>

        <Tooltip closeDelay={0} delay={80}>
          <Tooltip.Trigger>
            <div className="inline-flex">
              <Button
                isIconOnly
                size="sm"
                variant="outline"
                className="h-6 w-6 min-w-6 rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]"
                onPress={() => window.open(issue.htmlUrl, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={11} />
              </Button>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>Abrir en GitHub</Tooltip.Content>
        </Tooltip>

        <Tooltip closeDelay={0} delay={80}>
          <Tooltip.Trigger>
            <div className="inline-flex">
              <Button
                isIconOnly
                size="sm"
                variant="outline"
                className="h-6 w-6 min-w-6 rounded-[0.4rem] border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-muted))] shadow-sm hover:border-[rgb(var(--app-accent))]/40 hover:text-[rgb(var(--app-foreground))]"
                onPress={() => onRestoreIssue(issue.issueKey)}
              >
                <RotateCcw size={11} />
              </Button>
            </div>
          </Tooltip.Trigger>
          <Tooltip.Content showArrow>Restaurar al dashboard</Tooltip.Content>
        </Tooltip>
      </div>

      <div className="pr-4 text-[0.61rem] font-semibold uppercase tracking-[0.14em] text-[rgb(var(--app-muted))]">
        {issue.repository.name} #{issue.number}
      </div>

      <p className="mt-1 line-clamp-2 text-[0.84rem] font-medium leading-5 text-[rgb(var(--app-foreground))]">
        {issue.title}
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-[rgb(var(--app-muted))]">
        <span className="truncate">
          {issue.localState.localCompletedAt
            ? `Cerrada el ${formatAbsoluteTimestamp(issue.localState.localCompletedAt)}`
            : ""}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {issue.localState.isPinned ? <Pin size={11} /> : null}
          {hasMeaningfulNotes(issue.localState.noteBlocks) ? (
            <NotebookText size={11} />
          ) : null}
        </div>
      </div>
    </button>
  );
});

// ─── Column ────────────────────────────────────────────────────────────────────

function BoardColumn({
  column,
  draggedIssueKey,
  issues,
  selectedIssueKey,
  onIssueDragEnd,
  onIssueDragStart,
  onIssueSelect,
  onRestoreIssue,
  onIssueDrop,
}: {
  column: ColumnDef;
  draggedIssueKey: string | null;
  issues: DashboardIssue[];
  selectedIssueKey: string | null;
  onIssueDragEnd: () => void;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
  onIssueDrop?: (event: DragEvent<HTMLElement>) => void;
}) {
  const Icon = column.icon;

  return (
    <section
      aria-label={column.label}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1rem] border bg-[rgb(var(--app-surface-strong))]/88 ${
        draggedIssueKey
          ? "border-[rgb(var(--app-accent))]/60"
          : "border-[rgb(var(--app-border))]/65"
      }`}
      style={{ borderTop: `4px solid ${column.color}` }}
      onDragOver={(e) => {
        if (draggedIssueKey) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(e) => {
        if (draggedIssueKey && onIssueDrop) {
          onIssueDrop(e);
        }
      }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        style={getColumnHeaderStyle(column)}
      >
        <div className="inline-flex items-center gap-2">
          <Icon size={16} />
          <span className="text-sm font-semibold">{column.label}</span>
        </div>
        <span className="rounded bg-[rgb(var(--app-surface))]/95 px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--app-muted))]">
          {issues.length}
        </span>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="space-y-2 px-1 pb-2">
          {issues.length === 0 ? (
            <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
              {column.emptyLabel}
            </div>
          ) : (
            issues.map((issue) => (
              <IssueCard
                key={issue.issueKey}
                isDragging={draggedIssueKey === issue.issueKey}
                issue={issue}
                selectedIssueKey={selectedIssueKey}
                onIssueDragEnd={onIssueDragEnd}
                onIssueDragStart={onIssueDragStart}
                onIssueSelect={onIssueSelect}
                onRestoreIssue={onRestoreIssue}
              />
            ))
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

interface DashboardCompletedBoardProps {
  activeIssue: DashboardIssue | null;
  reviewIssues: DashboardIssue[];
  completedIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  selectedIssueKey: string | null;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
  onReviewIssue: (issueKey: string) => void;
  onCompleteIssue: (issueKey: string) => void;
  onTogglePin: (issueKey: string) => void;
  onUpdateBlocks: (
    issueKey: string,
    nextBlocks: DashboardIssue["localState"]["noteBlocks"],
  ) => void;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueDragEnd: () => void;
}

// ─── DragState ─────────────────────────────────────────────────────────────────

type DragMode = "two-col" | "left-split" | "right-split";

interface DragState {
  mode: DragMode;
  startX: number;
  threeColumnLeft: number;
  threeColumnRight: number;
  twoColumnLeft: number;
}

// ─── Main component ────────────────────────────────────────────────────────────

export function DashboardCompletedBoard({
  activeIssue,
  reviewIssues,
  completedIssues,
  isSidebarCollapsed,
  selectedIssueKey,
  onCollapseSidebar,
  onExpandSidebar,
  onIssueSelect,
  onRestoreIssue,
  onReviewIssue,
  onCompleteIssue,
  onTogglePin,
  onUpdateBlocks,
  onIssueDragStart,
  onIssueDragEnd,
}: DashboardCompletedBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draggedIssueKey, setDraggedIssueKey] = useState<string | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(min-width: ${String(WIDE_LAYOUT_BREAKPOINT)}px)`)
      .matches;
  });
  const [twoColumnLeft, setTwoColumnLeft] = useState(50);
  const [threeColumnLeft, setThreeColumnLeft] = useState(40);
  const [threeColumnRight, setThreeColumnRight] = useState(20);

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
        const maxLeft =
          100 - THREE_COLUMN_MIN_RIGHT - THREE_COLUMN_MIN_CENTER;
        setThreeColumnLeft(
          clamp(
            dragState.threeColumnLeft + deltaPercent,
            THREE_COLUMN_MIN_LEFT,
            Math.min(THREE_COLUMN_MAX_LEFT, maxLeft),
          ),
        );
      }

      if (dragState.mode === "right-split") {
        const maxRight =
          100 - THREE_COLUMN_MIN_LEFT - THREE_COLUMN_MIN_CENTER;
        setThreeColumnRight(
          clamp(
            dragState.threeColumnRight - deltaPercent,
            THREE_COLUMN_MIN_RIGHT,
            maxRight,
          ),
        );
      }
    };

    const handleMouseUp = () => setDragState(null);
    const handleWindowBlur = () => setDragState(null);
    const handleMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget !== null) return;
      setDragState(null);
    };

    document.body.style.userSelect = "none";
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
    ? `minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px ${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(threeColumnRight / 100)})`}`
    : hasSidebarIssue
    ? `minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px 0px`
    : `minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr)`;

  const boardClassName = isWideLayout
    ? "grid h-full min-h-0"
    : "flex h-full min-h-0 flex-col gap-3";

  const handleDragStart = (event: DragEvent<HTMLElement>, issueKey: string) => {
    requestAnimationFrame(() => {
      setDraggedIssueKey(issueKey);
    });
    onIssueDragStart(event, issueKey);
  };

  const handleDragEnd = () => {
    setDraggedIssueKey(null);
    onIssueDragEnd();
  };

  return (
    <div
      ref={boardRef}
      className={boardClassName}
      style={isWideLayout ? { gridTemplateColumns: wideLayoutColumns } : {}}
    >
      {/* ── En revisión column ── */}
      <BoardColumn
        column={REVIEW_COLUMN}
        draggedIssueKey={draggedIssueKey}
        issues={reviewIssues}
        selectedIssueKey={selectedIssueKey}
        onIssueDragEnd={handleDragEnd}
        onIssueDragStart={handleDragStart}
        onIssueSelect={onIssueSelect}
        onRestoreIssue={onRestoreIssue}
        onIssueDrop={() => {
          if (draggedIssueKey) onReviewIssue(draggedIssueKey);
        }}
      />

      {isWideLayout ? (
        <ResizeHandle />
      ) : null}

      {/* ── Completadas column ── */}
      <BoardColumn
        column={COMPLETED_COLUMN}
        draggedIssueKey={draggedIssueKey}
        issues={completedIssues}
        selectedIssueKey={selectedIssueKey}
        onIssueDragEnd={handleDragEnd}
        onIssueDragStart={handleDragStart}
        onIssueSelect={onIssueSelect}
        onRestoreIssue={onRestoreIssue}
        onIssueDrop={() => {
          if (draggedIssueKey) onCompleteIssue(draggedIssueKey);
        }}
      />

      {hasSidebarIssue && isWideLayout ? (
        <ResizeHandle
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={isSidebarCollapsed ? onExpandSidebar : onCollapseSidebar}
          onPointerDown={isSidebarCollapsed ? undefined : (clientX) =>
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

      {/* ── Sidebar ── */}
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
                <IconActionButton
                  label="Copiar URL"
                  onPress={() => void navigator.clipboard.writeText(sidebarIssue.htmlUrl)}
                >
                  <Copy size={14} />
                </IconActionButton>
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
                  label="Restaurar al dashboard"
                  onPress={() => onRestoreIssue(sidebarIssue.issueKey)}
                >
                  <RotateCcw size={14} />
                </IconActionButton>
              </div>
            </div>

            <h2 className="mt-1.5 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
              {sidebarIssue.title}
            </h2>
          </div>

          <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2">
            <div className="flex items-center gap-3">
              <p className="min-w-[5.4rem] text-left text-[0.66rem] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--app-muted))]">
                Estado
              </p>

              <div className="grid w-full min-w-0 flex-1 grid-cols-2 gap-2">
                <Tooltip closeDelay={0} delay={80}>
                  <Tooltip.Trigger>
                    <div className="inline-flex w-full">
                      <Button
                        isIconOnly
                        aria-label="Mover a En revisión"
                        size="sm"
                        variant="outline"
                        className={`h-[1.95rem] w-full rounded-[0.82rem] ${sidebarIssue.localState.status === "in_review" ? "border-[#d97706]/70 bg-[#d97706]/15 text-[#d97706]" : "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] hover:border-[#d97706]/40 hover:bg-[#d97706]/5 hover:text-[#d97706]"}`}
                        onPress={() => onReviewIssue(sidebarIssue.issueKey)}
                      >
                        <Eye size={14} />
                      </Button>
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow>En revisión</Tooltip.Content>
                </Tooltip>
                
                <Tooltip closeDelay={0} delay={80}>
                  <Tooltip.Trigger>
                    <div className="inline-flex w-full">
                      <Button
                        isIconOnly
                        aria-label="Mover a Completadas"
                        size="sm"
                        variant="outline"
                        className={`h-[1.95rem] w-full rounded-[0.82rem] ${sidebarIssue.localState.status === "completed" ? "border-[rgb(var(--app-open))]/70 bg-[rgb(var(--app-open))]/15 text-[rgb(var(--app-open))]" : "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] hover:border-[rgb(var(--app-open))]/40 hover:bg-[rgb(var(--app-open))]/5 hover:text-[rgb(var(--app-open))]"}`}
                        onPress={() => onCompleteIssue(sidebarIssue.issueKey)}
                      >
                        <CheckCheck size={14} />
                      </Button>
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Content showArrow>Completadas</Tooltip.Content>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-3 py-2.5">
            <NotesBlockEditor
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
