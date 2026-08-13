"use client";

import { Button, Dropdown, Input } from "@heroui/react";
import {
  AlertCircle,
  CheckCircle2,
  FolderGit2,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

export interface DashboardFilterBarProps {
  hasActiveFilters: boolean;
  search: string;
  selectedPriority: string;
  selectedProject: string;
  selectedState: string;
  onClearFilters: () => void;
  onPriorityChange: (priority: string) => void;
  onProjectChange: (project: string) => void;
  onStateChange: (state: string) => void;
  onSearchChange: (search: string) => void;
}

function getProjectLabel(value: string): string {
  if (value === "all") return "Todos los proyectos";
  if (value === "edi") return "EDI (cembox-edi)";
  if (value === "infra") return "INFRA (cembox-infra)";
  if (value === "none") return "Sin proyecto";
  return value;
}

function getPriorityLabel(value: string): string {
  if (value === "all") return "Todas las prioridades";
  if (value === "1") return "Urgente (P1)";
  if (value === "2") return "Alta (P2)";
  if (value === "3") return "Media (P3)";
  if (value === "4") return "Baja (P4)";
  if (value === "none") return "Sin prioridad";
  return value;
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
  selectedPriority,
  selectedProject,
  selectedState,
  onClearFilters,
  onPriorityChange,
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
                <FolderGit2 size={14} className="text-[rgb(var(--app-muted))]" />
                <span>{getProjectLabel(selectedProject)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por proyecto">
                <Dropdown.Item id="all" onPress={() => onProjectChange("all")}>
                  Todos los proyectos
                </Dropdown.Item>
                <Dropdown.Item id="edi" onPress={() => onProjectChange("edi")}>
                  EDI (cembox-edi-sap...)
                </Dropdown.Item>
                <Dropdown.Item id="infra" onPress={() => onProjectChange("infra")}>
                  INFRA (cembox-infra...)
                </Dropdown.Item>
                <Dropdown.Item id="none" onPress={() => onProjectChange("none")}>
                  Sin proyecto / Otros
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          {/* Priority Dropdown */}
          <Dropdown>
            <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <AlertCircle size={14} className="text-[rgb(var(--app-muted))]" />
                <span>{getPriorityLabel(selectedPriority)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por prioridad">
                <Dropdown.Item id="all" onPress={() => onPriorityChange("all")}>
                  Todas las prioridades
                </Dropdown.Item>
                <Dropdown.Item id="1" onPress={() => onPriorityChange("1")}>
                  🔴 Urgente (P1)
                </Dropdown.Item>
                <Dropdown.Item id="2" onPress={() => onPriorityChange("2")}>
                  🟠 Alta (P2)
                </Dropdown.Item>
                <Dropdown.Item id="3" onPress={() => onPriorityChange("3")}>
                  🟡 Media (P3)
                </Dropdown.Item>
                <Dropdown.Item id="4" onPress={() => onPriorityChange("4")}>
                  🔵 Baja (P4)
                </Dropdown.Item>
                <Dropdown.Item id="none" onPress={() => onPriorityChange("none")}>
                  ⚪ Sin prioridad (Backlog)
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          {/* State Dropdown */}
          <Dropdown>
            <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <CheckCircle2 size={14} className="text-[rgb(var(--app-muted))]" />
                <span>{getStateLabel(selectedState)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por estado">
                <Dropdown.Item id="all" onPress={() => onStateChange("all")}>
                  Todos los estados
                </Dropdown.Item>
                <Dropdown.Item id="open" onPress={() => onStateChange("open")}>
                  🟢 Abiertas (Open)
                </Dropdown.Item>
                <Dropdown.Item id="in_review" onPress={() => onStateChange("in_review")}>
                  🟠 En revisión
                </Dropdown.Item>
                <Dropdown.Item id="closed" onPress={() => onStateChange("closed")}>
                  🟣 Cerradas (Closed)
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
