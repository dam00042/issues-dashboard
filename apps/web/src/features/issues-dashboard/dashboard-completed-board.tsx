"use client";

import { Button, Tooltip } from "@heroui/react";
import {
  CheckCheck,
  Copy,
  ExternalLink,
  Eye,
  NotebookText,
  PanelRightClose,
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
  onPointerDown,
  onToggleCollapse,
}: {
  onPointerDown: (clientX: number) => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <div className="relative hidden cursor-col-resize items-stretch justify-center xl:flex">
      <button
        aria-label="Redimensionar paneles"
        className="flex w-[10px] items-center justify-center cursor-col-resize"
        onMouseDown={(event) => onPointerDown(event.clientX)}
        type="button"
      >
        <div className="h-full w-px rounded-full bg-[rgb(var(--app-border))]/80 transition-colors hover:bg-[rgb(var(--app-accent))]" />
      </button>
      {onToggleCollapse ? (
        <button
          type="button"
          aria-label="Ocultar o mostrar panel lateral"
          className="absolute top-1/2 -translate-y-1/2 z-20 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[rgb(var(--app-border))]/80 bg-[rgb(var(--app-surface-strong))] text-[rgb(var(--app-muted))] shadow-md transition hover:border-[rgb(var(--app-accent))] hover:text-[rgb(var(--app-foreground))]"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          <PanelRightClose size={12} />
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
        className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-0.5 rounded-[0.9rem] border border-[rgb(var(--app-border))]/50 bg-[rgb(var(--app-surface-strong))]/60 p-0.5 opacity-0 shadow-sm backdrop-blur-md transition-opacity group-hover:opacity-100"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <IconActionButton
          label="Copiar URL"
          onPress={() => void navigator.clipboard.writeText(issue.htmlUrl)}
        >
          <Copy size={13} />
        </IconActionButton>
        <IconActionButton
          label="Abrir en GitHub"
          onPress={() => window.open(issue.htmlUrl, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink size={13} />
        </IconActionButton>
        <IconActionButton
          label="Restaurar al dashboard"
          onPress={() => onRestoreIssue(issue.issueKey)}
        >
          <RotateCcw size={13} />
        </IconActionButton>
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
}: {
  column: ColumnDef;
  draggedIssueKey: string | null;
  issues: DashboardIssue[];
  selectedIssueKey: string | null;
  onIssueDragEnd: () => void;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
}) {
  const Icon = column.icon;

  return (
    <section
      aria-label={column.label}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[rgb(var(--app-border))]/65 bg-[rgb(var(--app-surface-strong))]/88"
      style={{ borderTop: `4px solid ${column.color}` }}
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
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
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
  onIssueSelect,
  onRestoreIssue,
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

  const wideLayoutColumns = isSidebarVisible
    ? `${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(threeColumnLeft / 100)})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(SPLITTER_WIDTH_PX)}px ${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(threeColumnRight / 100)})`}`
    : `${`calc((100% - ${String(SPLITTER_WIDTH_PX)}px) * ${String(twoColumnLeft / 100)})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr)`;

  const boardClassName = isWideLayout
    ? "grid h-full min-h-0"
    : "flex h-full min-h-0 flex-col gap-3";

  const handleDragStart = (event: DragEvent<HTMLElement>, issueKey: string) => {
    setDraggedIssueKey(issueKey);
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
      />

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
      />

      {/* ── Sidebar ── */}
      {isSidebarVisible && sidebarIssue ? (
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

      {isSidebarVisible && isWideLayout ? (
        <ResizeHandle
          onToggleCollapse={onCollapseSidebar}
          onPointerDown={(clientX) =>
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
    </div>
  );
}
