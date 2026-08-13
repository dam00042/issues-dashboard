"use client";

import { useDroppable } from "@dnd-kit/core";
import { Button, Input } from "@heroui/react";
import {
  CheckCheck,
  ExternalLink,
  Eye,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
} from "lucide-react";
import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from "react";

import { CopyButton } from "@/features/issues-dashboard/components/copy-button";
import { IconActionButton } from "@/features/issues-dashboard/components/icon-action-button";
import { DraggableIssueCard } from "@/features/issues-dashboard/components/issue-card";
import { NotesBlockEditor } from "@/features/issues-dashboard/components/notes-block-editor";
import type { DashboardIssue } from "@/features/issues-dashboard/types";
import {
  formatAbsoluteTimestamp,
  getRemoteStateDotClassName,
} from "@/features/issues-dashboard/utils/dashboard-helpers";

export interface CompletedBoardProps {
  activeIssue: DashboardIssue | null;
  completedIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  reviewIssues: DashboardIssue[];
  search: string;
  selectedIssueKey: string | null;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onIssueSelect: (issueKey: string) => void;
  onRestoreIssue: (issueKey: string) => void;
  onReviewIssue?: (issueKey: string) => void;
  onCompleteIssue?: (issueKey: string) => void;
  onSearchChange: (nextValue: string) => void;
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
  const { isOver, setNodeRef } = useDroppable({
    id: `bucket-${bucketId}`,
    data: { type: "Bucket", priority: bucketId },
  });

  return (
    <section
      ref={setNodeRef}
      aria-label={title}
      className={`flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[rgb(var(--app-border))]/65 transition-colors ${
        isOver
          ? "bg-[rgb(var(--app-accent))]/10 border-[rgb(var(--app-accent))]/50"
          : "bg-[rgb(var(--app-surface-strong))]/88"
      }`}
    >
      <div
        className="flex items-center justify-between gap-2 border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5"
        style={headerBgStyle}
      >
        <div className="inline-flex items-center gap-2">
          <IconComponent size={16} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <span className="rounded bg-[rgb(var(--app-surface))]/95 px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--app-muted))]">
          {count}
        </span>
      </div>

      <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
        <div className="space-y-2 px-1 pb-2">{children}</div>
      </div>
    </section>
  );
}

export function CompletedBoard({
  activeIssue,
  completedIssues,
  isSidebarCollapsed,
  reviewIssues,
  search,
  selectedIssueKey,
  onCollapseSidebar,
  onExpandSidebar,
  onIssueSelect,
  onRestoreIssue,
  onReviewIssue,
  onCompleteIssue,
  onSearchChange,
  onUpdateBlocks,
}: CompletedBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [isWideLayout, setIsWideLayout] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(`(min-width: ${String(WIDE_LAYOUT_BREAKPOINT)}px)`).matches;
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
      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96">
        <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
              Búsqueda
            </h2>
          </div>

          <div className="mt-2">
            <Input
              aria-label="Buscar en completadas"
              placeholder="Filtrar issues completadas..."
              value={search}
              className="w-full"
              onChange={(event) => onSearchChange(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
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
                  issue={issue}
                  onIssueSelect={onIssueSelect}
                  selectedIssueKey={selectedIssueKey}
                  onCompleteIssue={onCompleteIssue}
                  onRestoreIssue={onRestoreIssue}
                />
              ))
            )}
          </DroppableBucket>
        </div>
      </section>

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
        <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3">
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
                  issue={issue}
                  onIssueSelect={onIssueSelect}
                  selectedIssueKey={selectedIssueKey}
                  onRestoreIssue={onRestoreIssue}
                  onReviewIssue={onReviewIssue}
                />
              ))
            )}
          </DroppableBucket>
        </div>
      </section>

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
                <CopyButton url={sidebarIssue.htmlUrl} iconSize={14} persistsOnCopy tooltipDelay={120} className="h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none transition hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))]" />
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

            <h2 className="mt-1.5 text-[15px] font-semibold leading-5 text-[rgb(var(--app-foreground))]">
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
