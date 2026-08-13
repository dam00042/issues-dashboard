"use client";

import { Button, Input } from "@heroui/react";
import {
  AlertCircle,
  FolderGit2,
  RotateCcw,
  Search,
  X,
} from "lucide-react";

export interface DashboardFilterBarProps {
  hasActiveFilters: boolean;
  projects: string[];
  search: string;
  selectedPriority: string;
  selectedProject: string;
  onClearFilters: () => void;
  onPriorityChange: (priority: string) => void;
  onProjectChange: (project: string) => void;
  onSearchChange: (search: string) => void;
}

export function DashboardFilterBar({
  hasActiveFilters,
  projects,
  search,
  selectedPriority,
  selectedProject,
  onClearFilters,
  onPriorityChange,
  onProjectChange,
  onSearchChange,
}: DashboardFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 py-1.5 shadow-sm backdrop-blur">
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
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

        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <FolderGit2 size={14} className="absolute left-2.5 z-10 text-[rgb(var(--app-muted))] pointer-events-none" />
            <select
              aria-label="Filtrar por proyecto"
              value={selectedProject}
              className="h-8 rounded-[0.8rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 pl-8 pr-3 text-xs font-medium text-[rgb(var(--app-foreground))] transition hover:border-[rgb(var(--app-accent))]/40 focus:outline-none"
              onChange={(e) => onProjectChange(e.target.value)}
            >
              <option value="all">Todos los proyectos</option>
              {projects.map((proj) => (
                <option key={proj} value={proj}>
                  {proj}
                </option>
              ))}
            </select>
          </div>

          <div className="relative flex items-center">
            <AlertCircle size={14} className="absolute left-2.5 z-10 text-[rgb(var(--app-muted))] pointer-events-none" />
            <select
              aria-label="Filtrar por prioridad"
              value={selectedPriority}
              className="h-8 rounded-[0.8rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 pl-8 pr-3 text-xs font-medium text-[rgb(var(--app-foreground))] transition hover:border-[rgb(var(--app-accent))]/40 focus:outline-none"
              onChange={(e) => onPriorityChange(e.target.value)}
            >
              <option value="all">Todas las prioridades</option>
              <option value="1">Urgente</option>
              <option value="2">Alta</option>
              <option value="3">Media</option>
              <option value="4">Baja</option>
              <option value="none">Sin prioridad (Backlog)</option>
            </select>
          </div>
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
