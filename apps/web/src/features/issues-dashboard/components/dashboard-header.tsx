"use client";

import { Button, Dropdown } from "@heroui/react";
import {
  CheckCircle2,
  Download,
  GitPullRequest,
  LayoutGrid,
  LogOut,
  Monitor,
  MoonStar,
  RefreshCw,
  SlidersHorizontal,
  SunMedium,
  Upload,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { DashboardSection } from "@/features/issues-dashboard/types";
import type { ThemeMode } from "@/types/desktop";

export interface DashboardHeaderProps {
  isDesktopClient: boolean;
  isFetching: boolean;
  lastRefreshLabel: string;
  section: DashboardSection;
  username: string | null;
  onClearSession: () => void;
  onEditSession: () => void;
  onExportDatabase: () => void;
  onImportDatabase: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSectionChange: (section: DashboardSection) => void;
  onCycleTheme: () => void;
}

export function DashboardHeader({
  isDesktopClient,
  isFetching,
  lastRefreshLabel,
  section,
  username,
  onClearSession,
  onEditSession,
  onExportDatabase,
  onImportDatabase,
  onOpenSettings,
  onRefresh,
  onSectionChange,
  onCycleTheme,
}: DashboardHeaderProps) {
  const { theme } = useTheme();

  function renderThemeIcon() {
    const currentTheme = (theme as ThemeMode) ?? "system";
    if (currentTheme === "light") return <SunMedium size={16} />;
    if (currentTheme === "dark") return <MoonStar size={16} />;
    return <Monitor size={16} />;
  }

  return (
    <header className="rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/96 px-3 py-1.5 shadow-sm">
      <div className="flex min-h-[2.3rem] flex-wrap items-center gap-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-[0.9rem] border border-[rgb(var(--app-border))]/75 bg-[rgb(var(--app-surface-strong))]/95 p-0.5">
            <Button
              size="sm"
              variant={section === "board" ? "primary" : "ghost"}
              className={
                section === "board"
                  ? "rounded-[0.75rem] bg-[rgb(var(--app-accent))]/14 px-3 text-[rgb(var(--app-accent-strong))]"
                  : "rounded-[0.75rem] px-3"
              }
              onPress={() => onSectionChange("board")}
            >
              <span className="inline-flex items-center gap-1.5">
                <LayoutGrid size={14} />
                <span>Dashboard</span>
              </span>
            </Button>
            <Button
              size="sm"
              variant={section === "completed" ? "primary" : "ghost"}
              className={
                section === "completed"
                  ? "rounded-[0.75rem] bg-[rgb(var(--app-open))]/14 px-3 text-[rgb(var(--app-open))]"
                  : "rounded-[0.75rem] px-3"
              }
              onPress={() => onSectionChange("completed")}
            >
              <span className="inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} />
                <span>Revisión y cierre</span>
              </span>
            </Button>
            <Button
              size="sm"
              variant={section === "pull_requests" ? "primary" : "ghost"}
              className={
                section === "pull_requests"
                  ? "rounded-[0.75rem] bg-[#a855f7]/14 px-3 text-[#a855f7]"
                  : "rounded-[0.75rem] px-3"
              }
              onPress={() => onSectionChange("pull_requests")}
            >
              <span className="inline-flex items-center gap-1.5">
                <GitPullRequest size={14} />
                <span>Pull Requests</span>
              </span>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          <span className="hidden px-1 text-[10px] text-[rgb(var(--app-muted))] xl:inline">
            {lastRefreshLabel}
          </span>
          <Button
            isIconOnly
            aria-label={
              section === "pull_requests"
                ? "Refrescar Pull Requests"
                : "Refrescar issues"
            }
            size="sm"
            variant="outline"
            onPress={onRefresh}
          >
            <RefreshCw className={isFetching ? "animate-spin" : ""} size={16} />
          </Button>
          <Button
            isIconOnly
            aria-label="Ajustes"
            size="sm"
            variant="outline"
            onPress={onOpenSettings}
          >
            <SlidersHorizontal size={16} />
          </Button>
          <Button
            isIconOnly
            aria-label="Cambiar tema"
            size="sm"
            variant="outline"
            onPress={onCycleTheme}
          >
            {renderThemeIcon()}
          </Button>

          {username ? (
            <Dropdown>
              <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
                <span className="flex items-center gap-1.5 text-xs">
                  <UserRound size={14} />@{username}
                </span>
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="Opciones de sesión">
                  <Dropdown.Item id="edit-session" onPress={onEditSession}>
                    <div className="flex items-center gap-2">
                      <UserRound size={14} />
                      <span>Editar sesión</span>
                    </div>
                  </Dropdown.Item>
                  {isDesktopClient ? (
                    <Dropdown.Item
                      id="export-database"
                      onPress={onExportDatabase}
                    >
                      <div className="flex items-center gap-2">
                        <Download size={14} />
                        <span>Exportar copia de seguridad</span>
                      </div>
                    </Dropdown.Item>
                  ) : null}
                  {isDesktopClient ? (
                    <Dropdown.Item
                      id="import-database"
                      onPress={onImportDatabase}
                    >
                      <div className="flex items-center gap-2">
                        <Upload size={14} />
                        <span>Importar copia de seguridad</span>
                      </div>
                    </Dropdown.Item>
                  ) : null}
                  <Dropdown.Item
                    id="logout"
                    className="text-[rgb(var(--app-danger))]"
                    onPress={onClearSession}
                  >
                    <div className="flex items-center gap-2">
                      <LogOut
                        size={14}
                        className="text-[rgb(var(--app-danger))]"
                      />
                      <span className="text-[rgb(var(--app-danger))]">
                        Cerrar sesión
                      </span>
                    </div>
                  </Dropdown.Item>
                </Dropdown.Menu>
              </Dropdown.Popover>
            </Dropdown>
          ) : null}
        </div>
      </div>
    </header>
  );
}
