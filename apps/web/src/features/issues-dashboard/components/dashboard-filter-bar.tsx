"use client";

import { Button, Dropdown, Input } from "@heroui/react";
import {
  CheckCircle2,
  Database,
  FolderGit2,
  FolderMinus,
  RotateCcw,
  Search,
  Server,
  X,
} from "lucide-react";

export interface DashboardFilterBarProps {
  hasActiveFilters: boolean;
  search: string;
  selectedProject: string;
  selectedState: string;
  onClearFilters: () => void;
  onProjectChange: (project: string) => void;
  onStateChange: (state: string) => void;
  onSearchChange: (search: string) => void;
}

function getProjectIcon(value: string) {
  if (value === "edi") return <Database size={14} className="text-[#0070f3]" />;
  if (value === "infra") return <Server size={14} className="text-[#d97706]" />;
  if (value === "none") return <FolderMinus size={14} className="text-[rgb(var(--app-muted))]" />;
  return <FolderGit2 size={14} className="text-[rgb(var(--app-muted))]" />;
}

function getProjectLabel(value: string): string {
  if (value === "all") return "Todos los proyectos";
  if (value === "edi") return "EDI";
  if (value === "infra") return "INFRA";
  if (value === "none") return "No project";
  return value;
}

function getStateIcon(value: string) {
  if (value === "open") return <CheckCircle2 size={14} className="text-[#22c55e]" />;
  if (value === "in_review") return <CheckCircle2 size={14} className="text-[#d97706]" />;
  if (value === "closed") return <CheckCircle2 size={14} className="text-[#a855f7]" />;
  return <CheckCircle2 size={14} className="text-[rgb(var(--app-muted))]" />;
}

function getStateLabel(value: string): string {
  if (value === "all") return "Todos los estados";
  if (value === "open") return "Abiertas (Open)";
  if (value === "in_review") return "En revisión";
  if (value === "closed") return "Cerradas (Closed)";
  return value;
}

export function DashboardFilterBar({
  hasActiveFilters,
  search,
  selectedProject,
  selectedState,
  onClearFilters,
  onProjectChange,
  onStateChange,
  onSearchChange,
}: DashboardFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 py-1.5 shadow-sm backdrop-blur">
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        {/* Search input */}
        <div className="relative min-w-[200px] flex-1 max-w-md flex items-center">
          <Search size={14} className="absolute left-2.5 z-10 text-[rgb(var(--app-muted))] pointer-events-none" />
          <Input
            aria-label="Buscar issue o repositorio"
            placeholder="Buscar por título, #issue o repositorio..."
            value={search}
            className="w-full pl-8 pr-8"
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {search ? (
            <button
              type="button"
              aria-label="Limpiar búsqueda"
              className="absolute right-2.5 z-10 text-[rgb(var(--app-muted))] hover:text-[rgb(var(--app-foreground))]"
              onClick={() => onSearchChange("")}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Project Dropdown */}
          <Dropdown>
            <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {getProjectIcon(selectedProject)}
                <span>{getProjectLabel(selectedProject)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por proyecto">
                <Dropdown.Item id="all" onPress={() => onProjectChange("all")}>
                  <div className="flex items-center gap-2">
                    <FolderGit2 size={14} className="text-[rgb(var(--app-muted))]" />
                    <span>Todos los proyectos</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="edi" onPress={() => onProjectChange("edi")}>
                  <div className="flex items-center gap-2">
                    <Database size={14} className="text-[#0070f3]" />
                    <span>EDI</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="infra" onPress={() => onProjectChange("infra")}>
                  <div className="flex items-center gap-2">
                    <Server size={14} className="text-[#d97706]" />
                    <span>INFRA</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="none" onPress={() => onProjectChange("none")}>
                  <div className="flex items-center gap-2">
                    <FolderMinus size={14} className="text-[rgb(var(--app-muted))]" />
                    <span>No project</span>
                  </div>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          {/* State Dropdown */}
          <Dropdown>
            <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                {getStateIcon(selectedState)}
                <span>{getStateLabel(selectedState)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por estado">
                <Dropdown.Item id="all" onPress={() => onStateChange("all")}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-[rgb(var(--app-muted))]" />
                    <span>Todos los estados</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="open" onPress={() => onStateChange("open")}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-[#22c55e]" />
                    <span>Abiertas (Open)</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="in_review" onPress={() => onStateChange("in_review")}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-[#d97706]" />
                    <span>En revisión</span>
                  </div>
                </Dropdown.Item>
                <Dropdown.Item id="closed" onPress={() => onStateChange("closed")}>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-[#a855f7]" />
                    <span>Cerradas (Closed)</span>
                  </div>
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        </div>
      </div>

      {hasActiveFilters ? (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 rounded-[0.7rem] px-2.5 text-xs text-[rgb(var(--app-danger))] hover:bg-[rgb(var(--app-danger))]/10"
          onPress={onClearFilters}
        >
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw size={12} />
            <span>Limpiar filtros</span>
          </span>
        </Button>
      ) : null}
    </div>
  );
}
