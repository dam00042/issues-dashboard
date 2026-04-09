"use client";

import { Button, Input, Tooltip } from "@heroui/react";
import {
  CheckCheck,
  ExternalLink,
  List,
  MessageSquareText,
  NotebookText,
  PanelRightClose,
  Pin,
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
  hasMeaningfulNotes,
  PRIORITY_DEFINITIONS,
} from "@/features/issues-dashboard/dashboard-helpers";
import { NotesBlockEditor } from "@/features/issues-dashboard/notes-block-editor";
import type {
  DashboardIssue,
  PriorityDefinition,
  PriorityValue,
} from "@/features/issues-dashboard/types";

interface PriorityBucket extends PriorityDefinition {
  issues: DashboardIssue[];
}

interface DashboardBoardProps {
  activeIssue: DashboardIssue | null;
  backlogIssues: DashboardIssue[];
  isSidebarCollapsed: boolean;
  priorityBuckets: PriorityBucket[];
  search: string;
  selectedIssueKey: string | null;
  onCollapseSidebar: () => void;
  onCompleteIssue: (issueKey: string) => void;
  onIssueDragEnd: () => void;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueDrop: (
    event: DragEvent<HTMLElement>,
    priority: PriorityValue | null,
  ) => void;
  onIssueSelect: (issueKey: string) => void;
  onOpenDescription: () => void;
  onSearchChange: (nextValue: string) => void;
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

function formatRelativeTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return "sin actividad reciente";
  }

  return new Intl.RelativeTimeFormat("es", { numeric: "auto" }).format(
    -Math.max(1, Math.round((Date.now() - Date.parse(timestamp)) / 86_400_000)),
    "day",
  );
}

function getRemoteStateDotClassName(
  remoteState: DashboardIssue["remoteState"],
): string {
  return remoteState === "open"
    ? "bg-[rgb(var(--app-open))]"
    : "bg-[rgb(var(--app-closed))]";
}

function getPriorityButtonClassName(
  definition: PriorityDefinition,
  isActive: boolean,
): string {
  if (isActive) {
    return definition.buttonClassName;
  }

  if (definition.value === 4) {
    return "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[#f85149]/40 hover:bg-[rgba(248,81,73,0.1)] hover:text-[#f85149]";
  }

  if (definition.value === 3) {
    return "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[#d97706]/40 hover:bg-[rgba(217,119,6,0.1)] hover:text-[#d97706]";
  }

  if (definition.value === 2) {
    return "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[#2563eb]/40 hover:bg-[rgba(37,99,235,0.1)] hover:text-[#2563eb]";
  }

  return "border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[#6b7280]/40 hover:bg-[rgba(107,114,128,0.1)] hover:text-[#9ca3af]";
}

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

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (clientX: number) => void;
}) {
  return (
    <button
      aria-label="Redimensionar paneles"
      className="hidden cursor-col-resize items-stretch justify-center xl:flex"
      onMouseDown={(event) => onPointerDown(event.clientX)}
      type="button"
    >
      <div className="flex w-[10px] items-center justify-center">
        <div className="h-full w-px rounded-full bg-[rgb(var(--app-border))]/80 transition-colors hover:bg-[rgb(var(--app-accent))]" />
      </div>
    </button>
  );
}

const IssueCard = memo(function IssueCard({
  isDragging,
  issue,
  onIssueDragEnd,
  selectedIssueKey,
  onIssueDragStart,
  onIssueSelect,
}: {
  isDragging: boolean;
  issue: DashboardIssue;
  onIssueDragEnd: () => void;
  selectedIssueKey: string | null;
  onIssueDragStart: (event: DragEvent<HTMLElement>, issueKey: string) => void;
  onIssueSelect: (issueKey: string) => void;
}) {
  return (
    <button
      type="button"
      className={`relative w-full cursor-pointer rounded-[0.9rem] border px-2.5 py-2 text-left transition-[border-color,background-color,box-shadow,transform,opacity] duration-75 will-change-transform hover:border-[rgb(var(--app-accent))]/45 hover:bg-[rgb(var(--app-accent))]/4 active:cursor-grabbing ${
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
          {issue.localState.isPinned ? <Pin size={11} /> : null}
          {hasMeaningfulNotes(issue.localState.noteBlocks) ? (
            <NotebookText size={11} />
          ) : null}
        </div>
      </div>
    </button>
  );
});

export function DashboardBoard({
  activeIssue,
  backlogIssues,
  isSidebarCollapsed,
  priorityBuckets,
  search,
  selectedIssueKey,
  onCollapseSidebar,
  onCompleteIssue,
  onIssueDragEnd,
  onIssueDragStart,
  onIssueDrop,
  onIssueSelect,
  onOpenDescription,
  onSearchChange,
  onSetPriority,
  onTogglePin,
  onUpdateBlocks,
}: DashboardBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [draggedIssueKey, setDraggedIssueKey] = useState<string | null>(null);
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

  const wideLayoutColumns = isSidebarVisible
    ? `${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(
        threeColumnLeft / 100,
      )})`} ${String(SPLITTER_WIDTH_PX)}px minmax(0, 1fr) ${String(
        SPLITTER_WIDTH_PX,
      )}px ${`calc((100% - ${String(SPLITTER_WIDTH_PX * 2)}px) * ${String(
        threeColumnRight / 100,
      )})`}`
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
      <section
        aria-label="Backlog de issues"
        className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[1.2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96"
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          onIssueDrop(event, null);
          setDraggedIssueKey(null);
        }}
      >
        <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
              Backlog
            </h2>
            <span className="text-[11px] text-[rgb(var(--app-muted))]">
              {backlogIssues.length}
            </span>
          </div>

          <div className="mt-2">
            <Input
              aria-label="Buscar issue"
              placeholder="Buscar issue o repositorio"
              value={search}
              className="w-full"
              onChange={(event) => onSearchChange(event.target.value)}
            />
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
                <IssueCard
                  isDragging={draggedIssueKey === issue.issueKey}
                  key={issue.issueKey}
                  issue={issue}
                  onIssueDragEnd={() => {
                    setDraggedIssueKey(null);
                    onIssueDragEnd();
                  }}
                  onIssueDragStart={(event, draggedIssueKey) => {
                    setDraggedIssueKey(draggedIssueKey);
                    onIssueDragStart(event, draggedIssueKey);
                  }}
                  onIssueSelect={onIssueSelect}
                  selectedIssueKey={selectedIssueKey}
                />
              ))
            )}
          </div>
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
        <div className="border-b border-[rgb(var(--app-border))]/55 px-3 py-2.5">
          <h2 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
            Matriz de prioridades
          </h2>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 p-3 md:grid-cols-2 md:grid-rows-2">
          {priorityBuckets.map((bucket) => {
            const BucketIcon = bucket.icon;

            return (
              <section
                key={bucket.value}
                aria-label={`Prioridad ${bucket.label}`}
                className="flex min-h-[210px] min-w-0 flex-col overflow-hidden rounded-[1rem] border border-[rgb(var(--app-border))]/65 bg-[rgb(var(--app-surface-strong))]/88"
                style={{ borderTop: `4px solid ${bucket.color}` }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  onIssueDrop(event, bucket.value);
                  setDraggedIssueKey(null);
                }}
              >
                <div
                  className={`flex items-center justify-between gap-2 px-3 py-2.5 ${bucket.headerClassName}`}
                  style={getQuadrantHeaderStyle(bucket)}
                >
                  <div className="inline-flex items-center gap-2">
                    <BucketIcon size={16} />
                    <span className="text-sm font-semibold">
                      {bucket.label}
                    </span>
                  </div>
                  <span className="rounded bg-[rgb(var(--app-surface))]/95 px-1.5 py-0.5 text-[11px] font-semibold text-[rgb(var(--app-muted))]">
                    {bucket.issues.length}
                  </span>
                </div>

                <div className="app-scrollbar min-h-0 flex-1 overflow-auto px-2 py-2">
                  <div className="space-y-2 px-1 pb-2">
                    {bucket.issues.length === 0 ? (
                      <div className="rounded-[1rem] border border-dashed border-[rgb(var(--app-border))]/60 px-4 py-8 text-center text-sm text-[rgb(var(--app-muted))]">
                        Arrastra aquí una issue priorizada.
                      </div>
                    ) : (
                      bucket.issues.map((issue) => (
                        <IssueCard
                          isDragging={draggedIssueKey === issue.issueKey}
                          key={issue.issueKey}
                          issue={issue}
                          onIssueDragEnd={() => {
                            setDraggedIssueKey(null);
                            onIssueDragEnd();
                          }}
                          onIssueDragStart={(event, draggedIssueKey) => {
                            setDraggedIssueKey(draggedIssueKey);
                            onIssueDragStart(event, draggedIssueKey);
                          }}
                          onIssueSelect={onIssueSelect}
                          selectedIssueKey={selectedIssueKey}
                        />
                      ))
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </section>

      {isSidebarVisible && isWideLayout ? (
        <ResizeHandle
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
                  label="Ver descripción"
                  onPress={onOpenDescription}
                >
                  <MessageSquareText size={14} />
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
                  label="Completar localmente"
                  onPress={() => onCompleteIssue(sidebarIssue.issueKey)}
                >
                  <CheckCheck size={14} />
                </IconActionButton>
                <IconActionButton
                  label="Ocultar panel"
                  onPress={onCollapseSidebar}
                >
                  <PanelRightClose size={14} />
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
                Prioridad
              </p>

              <div className="grid w-full min-w-0 flex-1 grid-cols-5 gap-2">
                {PRIORITY_DEFINITIONS.map((definition) => {
                  const PriorityIcon = definition.icon;

                  return (
                    <Tooltip key={definition.value} closeDelay={0} delay={80}>
                      <Tooltip.Trigger>
                        <div className="inline-flex w-full">
                          <Button
                            isIconOnly
                            aria-label={`Asignar prioridad ${definition.label}`}
                            size="sm"
                            variant="outline"
                            className={`h-[1.95rem] w-full rounded-[0.82rem] ${getPriorityButtonClassName(
                              definition,
                              sidebarIssue.localState.priority ===
                                definition.value,
                            )}`}
                            onPress={() =>
                              onSetPriority(
                                sidebarIssue.issueKey,
                                definition.value,
                              )
                            }
                          >
                            <PriorityIcon size={14} />
                          </Button>
                        </div>
                      </Tooltip.Trigger>
                      <Tooltip.Content
                        showArrow
                        className={definition.tooltipClassName}
                      >
                        {definition.label}
                      </Tooltip.Content>
                    </Tooltip>
                  );
                })}

                <Tooltip closeDelay={0} delay={80}>
                  <Tooltip.Trigger>
                    <div className="inline-flex w-full">
                      <Button
                        isIconOnly
                        aria-label="Mover a backlog"
                        size="sm"
                        variant="outline"
                        className={
                          sidebarIssue.localState.priority === null
                            ? "h-[1.95rem] w-full rounded-[0.82rem] border-[rgb(var(--app-accent))]/50 bg-[rgb(var(--app-accent))]/12 text-[rgb(var(--app-accent-strong))]"
                            : "h-[1.95rem] w-full rounded-[0.82rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[rgb(var(--app-accent))]/40 hover:bg-[rgb(var(--app-accent))]/8 hover:text-[rgb(var(--app-accent-strong))]"
                        }
                        onPress={() =>
                          onSetPriority(sidebarIssue.issueKey, null)
                        }
                      >
                        <List size={14} />
                      </Button>
                    </div>
                  </Tooltip.Trigger>
                  <Tooltip.Content
                    showArrow
                    className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]"
                  >
                    Backlog
                  </Tooltip.Content>
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
