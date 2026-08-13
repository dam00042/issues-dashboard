"use client";

import { Button, Chip, Dropdown } from "@heroui/react";
import {
  KeyRound,
  LayoutGrid,
  Loader2,
  LogOut,
  Monitor,
  MoonStar,
  RefreshCw,
  SunMedium,
  Upload,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";

import type { DashboardSection } from "@/features/issues-dashboard/types";

export interface DashboardHeaderProps {
  activeCount: number;
  completedCount: number;
  dirtyCount: number;
  isFetching: boolean;
  isSyncing: boolean;
  section: DashboardSection;
  username: string | null;
  onClearSession: () => void;
  onEditSession: () => void;
  onRefresh: () => void;
  onSectionChange: (section: DashboardSection) => void;
}

export function DashboardHeader({
  activeCount,
  completedCount,
  dirtyCount,
  isFetching,
  isSyncing,
  section,
  username,
  onClearSession,
  onEditSession,
  onRefresh,
  onSectionChange,
}: DashboardHeaderProps) {
  const { setTheme } = useTheme();

  const syncStatusLabel = isSyncing
    ? "Sincronizando..."
    : dirtyCount > 0
    ? `${dirtyCount} cambio${dirtyCount > 1 ? "s" : ""} pendiente${dirtyCount > 1 ? "s" : ""}`
    : "Sincronizado";

  return (
    <header className="shrink-0 px-4 pt-3 pb-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[0.7rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/95 text-[rgb(var(--app-foreground))] shadow-xs">
              <LayoutGrid size={15} />
            </div>
            <div>
              <h1 className="text-xs font-bold leading-none text-[rgb(var(--app-foreground))]">
                Issues Dashboard
              </h1>
              <p className="mt-0.5 text-[10px] font-medium text-[rgb(var(--app-muted))]">
                @{username ?? "usuario"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-[0.85rem] border border-[rgb(var(--app-border))]/75 bg-[rgb(var(--app-surface-strong))]/95 p-1">
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 rounded-[0.65rem] px-3 text-xs font-semibold transition-all ${
                section === "board"
                  ? "bg-[#0070f3] text-white shadow-xs hover:bg-[#0060df]"
                  : "text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-foreground))]"
              }`}
              onPress={() => onSectionChange("board")}
            >
              Tablero ({activeCount})
            </Button>

            <Button
              size="sm"
              variant="ghost"
              className={`h-7 rounded-[0.65rem] px-3 text-xs font-semibold transition-all ${
                section === "completed"
                  ? "bg-[#0070f3] text-white shadow-xs hover:bg-[#0060df]"
                  : "text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-foreground))]"
              }`}
              onPress={() => onSectionChange("completed")}
            >
              Completadas ({completedCount})
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/90 text-[11px] font-medium text-[rgb(var(--app-foreground))]"
          >
            <div className="flex items-center gap-1.5">
              {isSyncing ? (
                <Loader2 size={12} className="animate-spin text-[rgb(var(--app-accent))]" />
              ) : dirtyCount > 0 ? (
                <Upload size={12} className="text-[#d97706]" />
              ) : (
                <span className="h-2 w-2 rounded-full bg-[rgb(var(--app-open))]" />
              )}
              <span>{syncStatusLabel}</span>
            </div>
          </Chip>

          <Button
            isIconOnly
            size="sm"
            variant="outline"
            aria-label="Actualizar datos de GitHub"
            className="h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))]"
            onPress={onRefresh}
          >
            <RefreshCw
              size={14}
              className={isFetching ? "animate-spin" : ""}
            />
          </Button>

          <Dropdown>
            <Dropdown.Trigger className="button button--icon-only button--sm button--outline h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))]">
              <KeyRound size={14} />
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Menú de opciones">
                <Dropdown.Item id="theme-system" onPress={() => setTheme("system")}>
                  <div className="flex items-center gap-2">
                    <Monitor size={14} />
                    <span>Sistema</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="theme-light" onPress={() => setTheme("light")}>
                  <div className="flex items-center gap-2">
                    <SunMedium size={14} />
                    <span>Claro</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="theme-dark" onPress={() => setTheme("dark")}>
                  <div className="flex items-center gap-2">
                    <MoonStar size={14} />
                    <span>Oscuro</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="edit-session" onPress={onEditSession}>
                  <div className="flex items-center gap-2">
                    <UserRound size={14} />
                    <span>Editar credenciales</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item
                  id="logout"
                  className="text-[rgb(var(--app-danger))]"
                  onPress={onClearSession}
                >
                  <div className="flex items-center gap-2">
                    <LogOut size={14} className="text-[rgb(var(--app-danger))]" />
                    <span className="text-[rgb(var(--app-danger))]">Cerrar sesión</span>
                  </div>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>
    </header>
  );
}
