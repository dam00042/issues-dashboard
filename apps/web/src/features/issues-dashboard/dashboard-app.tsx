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
  Input,
  Modal,
  ScrollShadow,
  Spinner,
} from "@heroui/react";
import {
  Download,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { ActiveBoard } from "@/features/issues-dashboard/boards/active-board";
import { CompletedBoard } from "@/features/issues-dashboard/boards/completed-board";
import { DashboardFilterBar } from "@/features/issues-dashboard/components/dashboard-filter-bar";
import { DashboardHeader } from "@/features/issues-dashboard/components/dashboard-header";
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
  ThemeDefinition,
} from "@/features/issues-dashboard/types";
import {
  filterIssuesBySearch,
  formatAbsoluteTimestamp,
  PRIORITY_DEFINITIONS,
  sortIssuesByPinnedAndUpdated,
  THEME_DEFINITIONS,
} from "@/features/issues-dashboard/utils/dashboard-helpers";
import type { ThemeMode } from "@/types/desktop";

const THEMES: ThemeDefinition[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

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

export function DashboardApp() {
  const { resolvedTheme, setTheme, theme } = useTheme();
  const [section, setSection] = useState<DashboardSection>("board");
  const [closedWindow, setClosedWindow] = useState<ClosedWindowOption>(
    DEFAULT_CLOSED_WINDOW,
  );
  const [closedWindowDraft, setClosedWindowDraft] = useState(
    DEFAULT_CLOSED_WINDOW,
  );
  const [closedWindowDraftError, setClosedWindowDraftError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedProject, setSelectedProject] = useState("all");
  const [selectedState, setSelectedState] = useState("all");
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [activeDragIssueKey, setActiveDragIssueKey] = useState<string | null>(
    null,
  );
  const [activeDragWidth, setActiveDragWidth] = useState<number | null>(null);

  const deferredSearch = useDeferredValue(search);

  function applyClosedWindow(closedWindowValue: ClosedWindowOption) {
    setClosedWindow(closedWindowValue);
    setClosedWindowDraft(closedWindowValue);
    setClosedWindowDraftError("");
    writeStoredPreference(STORAGE_KEYS.closedWindow, closedWindowValue);
    void fetchSnapshotData(closedWindowValue);
  }

  function applyClosedWindowDraft() {
    const parsedMonths = Number.parseInt(closedWindowDraft.trim(), 10);

    if (Number.isNaN(parsedMonths) || parsedMonths <= 0) {
      setClosedWindowDraftError("Indica un número entero positivo.");
      return;
    }

    applyClosedWindow(String(parsedMonths) as ClosedWindowOption);
    setSettingsOpen(false);
  }

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

  const projects = useMemo(() => {
    const set = new Set<string>();
    issues.forEach((issue) => {
      if (issue.repository?.name) {
        set.add(issue.repository.name);
      }
    });
    return Array.from(set).sort();
  }, [issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      // 1. Search Query Filter
      if (deferredSearch.trim()) {
        const q = deferredSearch.toLowerCase();
        const matchTitle = issue.title.toLowerCase().includes(q);
        const matchKey = issue.issueKey.toLowerCase().includes(q);
        const matchRepo = (issue.repository?.name || "").toLowerCase();
        const matchNum = String(issue.number).includes(q);
        if (!matchTitle && !matchKey && !matchRepo.includes(q) && !matchNum)
          return false;
      }

      // 2. Project Filter ("all" | "edi" | "infra" | "none")
      if (selectedProject !== "all") {
        const repoName = (issue.repository?.name || "").toLowerCase();
        if (selectedProject === "edi") {
          if (!repoName.includes("edi")) return false;
        } else if (selectedProject === "infra") {
          if (!repoName.includes("infra")) return false;
        } else if (selectedProject === "none") {
          if (repoName.includes("edi") || repoName.includes("infra")) return false;
        } else {
          if (issue.repository?.name !== selectedProject) return false;
        }
      }

      // 3. GitHub State Filter ("all" | "open" | "closed")
      if (selectedState !== "all") {
        if (selectedState === "open") {
          if (issue.remoteState !== "open") return false;
        } else if (selectedState === "closed") {
          if (issue.remoteState !== "closed") return false;
        }
      }

      return true;
    });
  }, [issues, deferredSearch, selectedProject, selectedState]);

  const activeIssues = useMemo(
    () => filteredIssues.filter((issue) => issue.localState.status === "active"),
    [filteredIssues],
  );

  const reviewIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        filteredIssues.filter((issue) => issue.localState.status === "in_review"),
      ),
    [filteredIssues],
  );

  const completedIssues = useMemo(
    () =>
      filteredIssues.filter((issue) => issue.localState.status === "completed"),
    [filteredIssues],
  );

  const backlogIssues = useMemo(
    () =>
      sortIssuesByPinnedAndUpdated(
        activeIssues.filter((issue) => issue.localState.priority === null),
      ),
    [activeIssues],
  );

  const priorityBuckets = useMemo(
    () =>
      PRIORITY_DEFINITIONS.map((definition) => ({
        ...definition,
        issues: sortIssuesByPinnedAndUpdated(
          activeIssues.filter(
            (issue) => issue.localState.priority === definition.value,
          ),
        ),
      })),
    [activeIssues],
  );

  const handleSectionChange = (nextSection: DashboardSection) => {
    setSection(nextSection);
    setSelectedIssueKey(null);
  };

  const activeIssue = useMemo(() => {
    if (!selectedIssueKey) return null;
    const issue = issues.find((item) => item.issueKey === selectedIssueKey) ?? null;
    if (!issue) return null;
    if (section === "board" && issue.localState.status !== "active") return null;
    if (section === "completed" && issue.localState.status === "active") return null;
    return issue;
  }, [issues, selectedIssueKey, section]);

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

  const snapshotConnectivityNotice =
    snapshotError && issues.length > 0
      ? "Sin conexión de red. Mostrando datos locales guardados; puedes seguir trabajando en local."
      : "";

  const topbarStatusMessage =
    syncError ||
    snapshotConnectivityNotice ||
    "";
  const topbarHasError = Boolean(syncError);
  const topbarHasWarning = !topbarHasError && Boolean(snapshotConnectivityNotice);
  const topbarShowSpinner = false;

  function cycleTheme() {
    if (resolvedTheme === "dark") setTheme("light");
    else setTheme("dark");
  }

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

  const hasActiveFilters = Boolean(
    search.trim() || selectedProject !== "all" || selectedState !== "all",
  );

  const handleClearFilters = () => {
    setSearch("");
    setSelectedProject("all");
    setSelectedState("all");
  };

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

      <main className="min-h-0 flex-1 overflow-hidden p-4 pt-3">
        <div className="flex h-full flex-col gap-2">
          <DashboardHeader
            isFetching={isFetchingSnapshot}
            section={section}
            topbarStatusMessage={topbarStatusMessage}
            topbarHasError={topbarHasError}
            topbarHasWarning={topbarHasWarning}
            topbarShowSpinner={topbarShowSpinner}
            username={sessionStatus.username}
            onClearSession={() => void handleClearSession()}
            onCycleTheme={cycleTheme}
            onEditSession={() => setIsEditingSession(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            onRefresh={() => void fetchSnapshotData(closedWindow)}
            onSectionChange={handleSectionChange}
          />

          <DashboardFilterBar
            hasActiveFilters={hasActiveFilters}
            search={search}
            selectedProject={selectedProject}
            selectedState={selectedState}
            onClearFilters={handleClearFilters}
            onProjectChange={setSelectedProject}
            onStateChange={setSelectedState}
            onSearchChange={setSearch}
          />

          <div className="min-h-0 flex-1">
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
          </div>
        </div>
      </main>

      <Modal>
        <Modal.Backdrop
          isDismissable
          isOpen={settingsOpen}
          variant="blur"
          onOpenChange={setSettingsOpen}
        >
          <Modal.Container size="md">
            <Modal.Dialog className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>Ajustes de issues cerradas</Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                <div className="space-y-4 px-1">
                  <p className="text-sm text-[rgb(var(--app-muted))]">
                    Elige si quieres ver todas las cerradas o limitar la vista
                    por un número manual de meses.
                  </p>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant={closedWindow === "all" ? "primary" : "outline"}
                      className={
                        closedWindow === "all"
                          ? "bg-[#0070f3] text-white"
                          : ""
                      }
                      onPress={() => {
                        applyClosedWindow("all");
                        setSettingsOpen(false);
                      }}
                    >
                      Mostrar todas
                    </Button>
                    <Button
                      size="sm"
                      variant={closedWindow === "1" ? "primary" : "outline"}
                      className={
                        closedWindow === "1"
                          ? "bg-[#0070f3] text-white"
                          : ""
                      }
                      onPress={() => {
                        applyClosedWindow("1");
                        setSettingsOpen(false);
                      }}
                    >
                      Cerradas: 1 mes
                    </Button>
                    <Chip
                      className="border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 text-[rgb(var(--app-muted))]"
                      variant="secondary"
                    >
                      {formatClosedWindowLabel(closedWindow)}
                    </Chip>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium text-[rgb(var(--app-foreground))]">
                      Límite manual en meses
                    </p>
                    <Input
                      aria-label="Número de meses para issues cerradas"
                      placeholder="6"
                      type="number"
                      className="w-full"
                      value={closedWindowDraft}
                      onChange={(event) => {
                        setClosedWindowDraft(event.target.value);
                        setClosedWindowDraftError("");
                      }}
                    />
                    <p className="text-xs text-[rgb(var(--app-muted))]">
                      Introduce cualquier entero positivo. Ejemplo: 2, 9 o 18.
                    </p>
                    {closedWindowDraftError ? (
                      <p className="text-xs font-medium text-[rgb(var(--app-danger))]">
                        {closedWindowDraftError}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button slot="close" variant="outline" onPress={() => setSettingsOpen(false)}>
                  Cerrar
                </Button>
                <Button variant="primary" className="bg-[#0070f3] text-white" onPress={applyClosedWindowDraft}>
                  Aplicar meses
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}
