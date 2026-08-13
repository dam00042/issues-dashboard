"use client";

import { Button, Dropdown } from "@heroui/react";
import {
  CheckCircle2,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  MoonStar,
  RefreshCw,
  Settings2,
  SunMedium,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { DashboardSection, ThemeDefinition } from "@/features/issues-dashboard/types";
import type { ThemeMode } from "@/types/desktop";

export interface DashboardHeaderProps {
  isFetching: boolean;
  section: DashboardSection;
  topbarStatusMessage: string;
  topbarHasError: boolean;
  topbarHasWarning: boolean;
  topbarShowSpinner: boolean;
  themeDefinitions: ThemeDefinition[];
  username: string | null;
  onClearSession: () => void;
  onEditSession: () => void;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onSectionChange: (section: DashboardSection) => void;
  onCycleTheme: () => void;
}

export function DashboardHeader({
  isFetching,
  section,
  topbarStatusMessage,
  topbarHasError,
  topbarHasWarning,
  topbarShowSpinner,
  themeDefinitions,
  username,
  onClearSession,
  onEditSession,
  onOpenSettings,
  onRefresh,
  onSectionChange,
  onCycleTheme,
}: DashboardHeaderProps) {
  const { resolvedTheme, setTheme } = useTheme();

  function getThemeIcon(themeValue: ThemeMode) {
    if (themeValue === "system") return <Monitor size={16} />;
    if (resolvedTheme === "dark") return <MoonStar size={16} />;
    return <SunMedium size={16} />;
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
                <span>Completadas</span>
              </span>
            </Button>
          </div>

          {topbarStatusMessage ? (
            <span
              className={`inline-flex max-w-[30rem] items-center gap-1.5 overflow-hidden text-ellipsis whitespace-nowrap rounded-[0.8rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 px-2.5 py-1 text-[11px] font-medium ${
                topbarHasError
                  ? "text-[rgb(var(--app-danger))]"
                  : topbarHasWarning
                  ? "text-[#d97706]"
                  : "text-[rgb(var(--app-muted))]"
              }`}
            >
              {topbarShowSpinner ? (
                <Loader2 className="animate-spin" size={12} />
              ) : null}
              <span className="truncate">{topbarStatusMessage}</span>
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button
            isIconOnly
            aria-label="Ajustes de cerradas"
            size="sm"
            variant="outline"
            onPress={onOpenSettings}
          >
            <Settings2 size={16} />
          </Button>
          <Button
            isIconOnly
            aria-label="Cambiar tema"
            size="sm"
            variant="outline"
            onPress={onCycleTheme}
          >
            {getThemeIcon("system")}
          </Button>
          <Button
            isIconOnly
            aria-label="Refrescar issues"
            size="sm"
            variant="outline"
            onPress={onRefresh}
          >
            <RefreshCw
              className={isFetching ? "animate-spin" : ""}
              size={16}
            />
          </Button>

          {username ? (
            <Dropdown>
              <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
                <span className="flex items-center gap-1.5 text-xs">
                  <UserRound size={14} />
                  @{username}
                </span>
              </Dropdown.Trigger>
              <Dropdown.Popover>
                <Dropdown.Menu aria-label="Opciones de sesión">
                  <Dropdown.Section aria-label="Tema">
                    {themeDefinitions.map((def) => (
                      <Dropdown.Item
                        key={def.value}
                        id={def.value}
                        onPress={() => setTheme(def.value)}
                      >
                        <div className="flex items-center gap-2">
                          {getThemeIcon(def.value)}
                          <span>{def.label}</span>
                        </div>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Section>
                  <Dropdown.Section aria-label="Sesión">
                    <Dropdown.Item
                      id="edit-session"
                      onPress={onEditSession}
                    >
                      <div className="flex items-center gap-2">
                        <Settings2 size={15} />
                        <span>Editar sesión</span>
                      </div>
                    </Dropdown.Item>
                    <Dropdown.Item
                      id="logout"
                      className="text-[rgb(var(--app-danger))]"
                      onPress={onClearSession}
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
          ) : null}
        </div>
      </div>
    </header>
  );
}
