"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  Button,
  Chip,
  Dropdown,
  Modal,
  ScrollShadow,
  Spinner,
} from "@heroui/react";
import {
  CheckCircle2,
  Download,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  MoonStar,
  RefreshCw,
  Settings2,
  SunMedium,
  Upload,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { ActiveBoard } from "@/features/issues-dashboard/boards/active-board";
import { CompletedBoard } from "@/features/issues-dashboard/boards/completed-board";
import { DesktopTitleBar } from "@/features/issues-dashboard/components/desktop-title-bar";
import { IssueCard } from "@/features/issues-dashboard/components/issue-card";
import { SessionScreen } from "@/features/issues-dashboard/components/session-screen";
import { useDesktopWindow } from "@/features/issues-dashboard/hooks/use-desktop-window";
import { useIssueSync } from "@/features/issues-dashboard/hooks/use-issue-sync";
import type {
  ClosedWindowOption,
  DashboardIssue,
  DashboardSection,
  PriorityValue,
} from "@/features/issues-dashboard/types";
import {
  filterIssuesBySearch,
  formatAbsoluteTimestamp,
  PRIORITY_DEFINITIONS,
  sortIssuesByPinnedAndUpdated,
  THEME_DEFINITIONS,
} from "@/features/issues-dashboard/utils/dashboard-helpers";
import type { ThemeMode } from "@/types/desktop";

const STORAGE_KEYS = {
  closedWindow: "issues-dashboard:closed-window",
};
const DEFAULT_CLOSED_WINDOW = "1";

function readStoredPreference<T>(storageKey: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const rawValue = window.localStorage.getItem(storageKey);
  if (!rawValue) return fallback;
  try {
    return JSON.parse(rawValue) as T;
  } catch {
    return fallback;
  }
}

function writeStoredPreference<T>(storageKey: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(value));
}

function normalizeClosedWindowOption(
  rawValue: string,
  fallback: ClosedWindowOption = DEFAULT_CLOSED_WINDOW,
): ClosedWindowOption {
  const normalizedValue = rawValue.trim().toLowerCase();
  if (normalizedValue === "all") return "all";
  const parsedMonths = Number.parseInt(normalizedValue, 10);
  if (Number.isNaN(parsedMonths) || parsedMonths <= 0) return fallback;
  return String(parsedMonths) as ClosedWindowOption;
}

function formatClosedWindowLabel(closedWindow: ClosedWindowOption): string {
  if (closedWindow === "all") return "Cerradas: todas";
  if (closedWindow === "1") return "Cerradas: 1 mes";
  return `Cerradas: ${closedWindow} meses`;
}

function getThemeIcon(theme: ThemeMode, resolvedTheme?: string) {
  if (theme === "system") return <Monitor size={16} />;
  if (resolvedTheme === "dark") return <MoonStar size={16} />;
  return <SunMedium size={16} />;
}

export function DashboardApp() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [section, setSection] = useState<DashboardSection>("board");
  const [closedWindow, setClosedWindow] = useState<ClosedWindowOption>(
    DEFAULT_CLOSED_WINDOW,
  );
  const [closedWindowDraft, setClosedWindowDraft] = useState(
    DEFAULT_CLOSED_WINDOW,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeDragIssueKey, setActiveDragIssueKey] = useState<string | null>(
    null,
  );
  const [activeDragWidth, setActiveDragWidth] = useState<number | null>(null);

  const deferredSearch = useDeferredValue(search);

  const {
    handleClose,
    handleMinimize,
    handleToggleMaximize,
    isDesktopClient,
    isMaximized,
  } = useDesktopWindow((theme as ThemeMode) ?? "system");

  const {
    backendReady,
    backendReadyError,
    completeIssue,
    dirtyIssueKeys,
    fetchSnapshotData,
    flushDirtyIssueStates,
    handleClearSession,
    handleSaveSession,
    isEditingSession,
    isFetchingSnapshot,
    isSavingSession,
    isSyncingState,
    issues,
    reviewIssue,
    restoreIssue,
    sessionError,
    sessionForm,
    sessionStatus,
    setFormValue,
    setIsEditingSession,
    setPriority,
    snapshot,
    snapshotError,
    syncError,
    togglePin,
    updateNoteBlocks,
  } = useIssueSync(closedWindow);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  useEffect(() => {
    const storedOption = readStoredPreference<string>(
      STORAGE_KEYS.closedWindow,
      DEFAULT_CLOSED_WINDOW,
    );
    const normalized = normalizeClosedWindowOption(storedOption);
    setClosedWindow(normalized);
    setClosedWindowDraft(normalized);
  }, []);

  const activeIssues = useMemo(
    () => issues.filter((issue) => issue.localState.status === "active"),
    [issues],
  );

  const reviewIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        filterIssuesBySearch(
          issues.filter((issue) => issue.localState.status === "in_review"),
          deferredSearch,
        ),
      ),
    [issues, deferredSearch],
  );

  const completedIssues = useMemo(
    () =>
      filterIssuesBySearch(
        issues.filter((issue) => issue.localState.status === "completed"),
        deferredSearch,
      ),
    [issues, deferredSearch],
  );

  const filteredActiveIssues = useMemo(
    () => filterIssuesBySearch(activeIssues, deferredSearch),
    [activeIssues, deferredSearch],
  );

  const backlogIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        filteredActiveIssues.filter(
          (issue) => issue.localState.priority === null,
        ),
      ),
    [filteredActiveIssues],
  );

  const priorityBuckets = useMemo(
    () =>
      PRIORITY_DEFINITIONS.map((definition) => ({
        ...definition,
        issues: sortIssuesByPinnedAndUpdated(
          filteredActiveIssues.filter(
            (issue) => issue.localState.priority === definition.value,
          ),
        ),
      })),
    [filteredActiveIssues],
  );

  const activeIssue = useMemo(
    () =>
      selectedIssueKey
        ? issues.find((issue) => issue.issueKey === selectedIssueKey) ?? null
        : null,
    [issues, selectedIssueKey],
  );

  const draggedIssue = useMemo(
    () =>
      activeDragIssueKey
        ? issues.find((issue) => issue.issueKey === activeDragIssueKey) ?? null
        : null,
    [activeDragIssueKey, issues],
  );

  const handleIssueSelect = (issueKey: string) => {
    setSelectedIssueKey(issueKey);
    setIsSidebarCollapsed(false);
  };

  const handleDndDragStart = (event: DragStartEvent) => {
    setActiveDragIssueKey(String(event.active.id));
    const activeElement = document.querySelector(
      `[data-dnd-id="${String(event.active.id)}"]`,
    ) || (event.active.rect.current.translated ? null : null);
    if (activeElement) {
      setActiveDragWidth(activeElement.getBoundingClientRect().width);
    } else if (event.active.rect.current.initial) {
      setActiveDragWidth(event.active.rect.current.initial.width);
    }
  };

  const handleDndDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragIssueKey(null);
    setActiveDragWidth(null);

    if (!over) return;

    const issueKey = String(active.id);
    const overId = String(over.id);

    if (overId === "bucket-review") {
      reviewIssue(issueKey);
      return;
    }

    if (overId === "bucket-completed") {
      completeIssue(issueKey);
      return;
    }

    if (overId.startsWith("bucket-")) {
      const priorityRaw = overId.replace("bucket-", "");
      const nextPriority: PriorityValue | null =
        priorityRaw === "null"
          ? null
          : (Number.parseInt(priorityRaw, 10) as PriorityValue);

      const targetIssue = issues.find((i) => i.issueKey === issueKey);
      if (targetIssue && targetIssue.localState.status !== "active") {
        restoreIssue(issueKey);
      }
      setPriority(issueKey, nextPriority);
    }
  };

  const syncStatusLabel = isSyncingState
    ? "Sincronizando..."
    : dirtyIssueKeys.size > 0
    ? `${dirtyIssueKeys.size} cambio${dirtyIssueKeys.size > 1 ? "s" : ""} pendiente${dirtyIssueKeys.size > 1 ? "s" : ""}`
    : "Sincronizado";

  if (!backendReady) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-md rounded-[2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6 shadow-xl backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[rgb(var(--app-muted))]">
            Servidor Local
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[rgb(var(--app-foreground))]">
            Iniciando conexión con Python...
          </h1>
          {backendReadyError ? (
            <div className="mt-4 rounded-2xl border border-[rgb(var(--app-danger))]/35 bg-[rgb(var(--app-danger))]/10 p-4 text-sm text-[rgb(var(--app-danger))]">
              {backendReadyError}
            </div>
          ) : (
            <div className="mt-6 flex justify-center py-4">
              <Spinner size="lg" />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!sessionStatus?.configured || isEditingSession) {
    return (
      <SessionScreen
        errorMessage={sessionError}
        form={sessionForm}
        isEditing={isEditingSession}
        isSaving={isSavingSession}
        topInset={isDesktopClient}
        onCancel={() => setIsEditingSession(false)}
        onChange={setFormValue}
        onSave={() => void handleSaveSession()}
      />
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[rgb(var(--app-bg))] font-sans antialiased">
      {isDesktopClient ? (
        <div className="shrink-0 p-2 pb-0">
          <DesktopTitleBar
            isMaximized={isMaximized}
            onClose={handleClose}
            onMinimize={handleMinimize}
            onToggleMaximize={handleToggleMaximize}
          />
        </div>
      ) : null}

      <header className="shrink-0 px-4 pt-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-4 py-2.5 shadow-sm backdrop-blur">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[0.7rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-accent))]/12 text-[rgb(var(--app-accent-strong))]">
                <LayoutGrid size={18} />
              </div>
              <div>
                <h1 className="text-sm font-semibold leading-none text-[rgb(var(--app-foreground))]">
                  Issues Dashboard
                </h1>
                <p className="mt-1 text-[11px] text-[rgb(var(--app-muted))]">
                  @{sessionStatus.username}
                </p>
              </div>
            </div>

            <div className="h-4 w-px bg-[rgb(var(--app-border))]/60" />

            <nav className="flex items-center gap-1 rounded-[0.8rem] border border-[rgb(var(--app-border))]/55 bg-[rgb(var(--app-surface-strong))]/60 p-1">
              <Button
                size="sm"
                variant={section === "board" ? "primary" : "ghost"}
                className="h-7 text-xs"
                onPress={() => setSection("board")}
              >
                Tablero ({activeIssues.length})
              </Button>
              <Button
                size="sm"
                variant={section === "completed" ? "primary" : "ghost"}
                className="h-7 text-xs"
                onPress={() => setSection("completed")}
              >
                Completadas ({completedIssues.length + reviewIssues.length})
              </Button>
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <Chip
              size="sm"
              className="border border-[rgb(var(--app-border))]/60 bg-[rgb(var(--app-surface-strong))]/80 text-xs"
            >
              <div className="flex items-center gap-1.5">
                {isSyncingState ? (
                  <Loader2 size={12} className="animate-spin text-[rgb(var(--app-accent))]" />
                ) : dirtyIssueKeys.size > 0 ? (
                  <Upload size={12} className="text-[#d97706]" />
                ) : (
                  <CheckCircle2 size={12} className="text-[rgb(var(--app-open))]" />
                )}
                <span>{syncStatusLabel}</span>
              </div>
            </Chip>

            <Button
              isIconOnly
              size="sm"
              variant="outline"
              aria-label="Actualizar datos de GitHub"
              className="h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90"
              onPress={() => void fetchSnapshotData(closedWindow)}
            >
              <RefreshCw
                size={14}
                className={isFetchingSnapshot ? "animate-spin" : ""}
              />
            </Button>

            <Dropdown>
              <Dropdown.Trigger className="button button--icon-only button--sm button--outline h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 text-[rgb(var(--app-foreground))]">
                <Settings2 size={14} />
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="Opciones de configuración">
                  <Dropdown.Section aria-label="Tema">
                    {THEME_DEFINITIONS.map((def) => (
                      <Dropdown.Item
                        key={def.value}
                        id={def.value}
                        onPress={() => setTheme(def.value)}
                      >
                        <div className="flex items-center gap-2">
                          {getThemeIcon(def.value as ThemeMode, resolvedTheme)}
                          <span>{def.label}</span>
                        </div>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Section>
                  <Dropdown.Section aria-label="Sesión">
                    <Dropdown.Item
                      id="edit-session"
                      onPress={() => setIsEditingSession(true)}
                    >
                      <div className="flex items-center gap-2">
                        <UserRound size={14} />
                        <span>Editar credenciales</span>
                      </div>
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="logout"
                      className="text-[rgb(var(--app-danger))]"
                      onPress={() => void handleClearSession()}
                    >
                      <div className="flex items-center gap-2">
                        <LogOut size={14} />
                        <span>Cerrar sesión</span>
                      </div>
                    </Dropdown.Item>
                  </Dropdown.Section>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          </div>
        </div>
      </header>

      {snapshotError || syncError ? (
        <div className="shrink-0 px-4 py-1">
          <div className="rounded-[0.9rem] border border-[rgb(var(--app-danger))]/35 bg-[rgb(var(--app-danger))]/10 px-3 py-2 text-xs text-[rgb(var(--app-danger))]">
            {snapshotError || syncError}
          </div>
        </div>
      ) : null}

      <main className="min-h-0 flex-1 overflow-hidden p-4 pt-1">
        {section === "board" ? (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDndDragStart}
            onDragEnd={handleDndDragEnd}
          >
            <ActiveBoard
              activeIssue={activeIssue}
              backlogIssues={backlogIssues}
              isSidebarCollapsed={isSidebarCollapsed}
              priorityBuckets={priorityBuckets}
              search={search}
              selectedIssueKey={selectedIssueKey}
              onCollapseSidebar={() => setIsSidebarCollapsed(true)}
              onExpandSidebar={() => setIsSidebarCollapsed(false)}
              onCompleteIssue={completeIssue}
              onReviewIssue={reviewIssue}
              onIssueSelect={handleIssueSelect}
              onSearchChange={setSearch}
              onSetPriority={setPriority}
              onTogglePin={togglePin}
              onUpdateBlocks={updateNoteBlocks}
            />
            <DragOverlay dropAnimation={null}>
              {draggedIssue ? (
                <div style={{ width: activeDragWidth ? `${activeDragWidth}px` : "100%" }}>
                  <IssueCard
                    isDragging
                    issue={draggedIssue}
                    selectedIssueKey={selectedIssueKey}
                    onIssueSelect={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDndDragStart}
            onDragEnd={handleDndDragEnd}
          >
            <CompletedBoard
              activeIssue={activeIssue}
              completedIssues={completedIssues}
              isSidebarCollapsed={isSidebarCollapsed}
              reviewIssues={reviewIssues}
              search={search}
              selectedIssueKey={selectedIssueKey}
              onCollapseSidebar={() => setIsSidebarCollapsed(true)}
              onExpandSidebar={() => setIsSidebarCollapsed(false)}
              onIssueSelect={handleIssueSelect}
              onRestoreIssue={restoreIssue}
              onReviewIssue={reviewIssue}
              onCompleteIssue={completeIssue}
              onSearchChange={setSearch}
              onUpdateBlocks={updateNoteBlocks}
            />
            <DragOverlay dropAnimation={null}>
              {draggedIssue ? (
                <div style={{ width: activeDragWidth ? `${activeDragWidth}px` : "100%" }}>
                  <IssueCard
                    isDragging
                    issue={draggedIssue}
                    selectedIssueKey={selectedIssueKey}
                    onIssueSelect={() => {}}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>
    </div>
  );
}
