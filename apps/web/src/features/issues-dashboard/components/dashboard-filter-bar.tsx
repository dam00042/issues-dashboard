"use client";

import { Button, Dropdown, Input } from "@heroui/react";
import {
  AlertCircle,
  Archive,
  ArrowDownCircle,
  ArrowUpCircle,
  BadgeCheck,
  CalendarRange,
  CircleCheckBig,
  CircleDot,
  CircleStop,
  Construction,
  Flag,
  FlaskConical,
  History,
  ListFilter,
  ListTodo,
  type LucideIcon,
  MinusCircle,
  Rocket,
  RotateCcw,
  ScanEye,
  Search,
  ServerCog,
  Tags,
  X,
} from "lucide-react";

import {
  getProjectPriorityDefinition,
  type ProjectPriorityIconName,
} from "@/features/issues-dashboard/project-priorities";
import {
  getProjectStatusDefinition,
  type ProjectStatusIconName,
} from "@/features/issues-dashboard/project-statuses";
import type {
  ProjectFilterDefinition,
  RemoteIssueStateFilter,
  SelectedProjectFields,
} from "@/features/issues-dashboard/types";

const PROJECT_STATUS_ICONS: Readonly<
  Record<ProjectStatusIconName, LucideIcon>
> = {
  archive: Archive,
  "badge-check": BadgeCheck,
  "circle-check": CircleCheckBig,
  "circle-stop": CircleStop,
  construction: Construction,
  flask: FlaskConical,
  history: History,
  "list-todo": ListTodo,
  rocket: Rocket,
  "scan-eye": ScanEye,
  server: ServerCog,
};

const PROJECT_STATUS_ICON_CLASSES: Readonly<Record<string, string>> = {
  approved: "text-emerald-500",
  backlog: "text-slate-400",
  develop: "text-green-500",
  done: "text-violet-500",
  "in-progress": "text-amber-500",
  "in-review": "text-orange-500",
  "integration-qa": "text-pink-500",
  production: "text-fuchsia-500",
  "second-life": "text-slate-400",
  stopped: "text-rose-500",
  "to-do": "text-blue-500",
};

const PROJECT_PRIORITY_ICONS: Readonly<
  Record<ProjectPriorityIconName, LucideIcon>
> = {
  "arrow-down-circle": ArrowDownCircle,
  "arrow-up-circle": ArrowUpCircle,
  "circle-alert": AlertCircle,
  "minus-circle": MinusCircle,
};

const PROJECT_PRIORITY_ICON_CLASSES: Readonly<Record<string, string>> = {
  critical: "text-red-500",
  high: "text-orange-500",
  low: "text-emerald-500",
  medium: "text-amber-500",
};

export interface DashboardFilterBarProps {
  hasActiveFilters: boolean;
  projectFieldFilters: ProjectFilterDefinition[];
  search: string;
  selectedProjectFields: SelectedProjectFields;
  selectedState: RemoteIssueStateFilter;
  onClearFilters: () => void;
  onProjectFieldChange: (fieldKey: string, value: string) => void;
  onSearchChange: (search: string) => void;
  onStateChange: (state: RemoteIssueStateFilter) => void;
}

function getFieldIcon(fieldKey: string) {
  if (fieldKey === "status") return CircleDot;
  if (fieldKey === "sprint" || fieldKey === "iteration") {
    return CalendarRange;
  }
  if (fieldKey === "priority") return Flag;
  return Tags;
}

function getStateLabel(value: RemoteIssueStateFilter): string {
  if (value === "open") return "Abiertas";
  if (value === "closed") return "Cerradas";
  return "Todos · Estado";
}

function getStateIconClassName(value: RemoteIssueStateFilter): string {
  if (value === "open") return "text-[#22c55e]";
  if (value === "closed") return "text-[#a855f7]";
  return "text-[rgb(var(--app-muted))]";
}

function StateIcon({ value }: { value: RemoteIssueStateFilter }) {
  const Icon =
    value === "open"
      ? CircleDot
      : value === "closed"
        ? CircleCheckBig
        : ListFilter;

  return <Icon size={14} className={getStateIconClassName(value)} />;
}

function ProjectStatusIcon({ value }: { value: string }) {
  const status = getProjectStatusDefinition(value);
  const Icon = status ? PROJECT_STATUS_ICONS[status.icon] : Tags;

  return (
    <Icon
      size={14}
      className={`shrink-0 ${
        status
          ? PROJECT_STATUS_ICON_CLASSES[status.key]
          : "text-[rgb(var(--app-muted))]"
      }`}
    />
  );
}

function ProjectPriorityIcon({ value }: { value: string }) {
  const priority = getProjectPriorityDefinition(value);
  const Icon = priority ? PROJECT_PRIORITY_ICONS[priority.icon] : Flag;

  return (
    <Icon
      size={14}
      className={`shrink-0 ${
        priority
          ? PROJECT_PRIORITY_ICON_CLASSES[priority.key]
          : "text-[rgb(var(--app-muted))]"
      }`}
    />
  );
}

interface ProjectFieldDropdownProps {
  definition: ProjectFilterDefinition;
  selectedValue: string;
  onChange: (fieldKey: string, value: string) => void;
}

function ProjectFieldDropdown({
  definition,
  selectedValue,
  onChange,
}: ProjectFieldDropdownProps) {
  const FieldIcon = getFieldIcon(definition.key);
  const displayValue =
    selectedValue === "all" ? definition.label : selectedValue;

  return (
    <Dropdown>
      <Dropdown.Trigger className="button button--sm button--outline max-w-[220px] rounded-[0.8rem] px-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {definition.key === "status" && selectedValue !== "all" ? (
            <ProjectStatusIcon value={selectedValue} />
          ) : definition.key === "priority" && selectedValue !== "all" ? (
            <ProjectPriorityIcon value={selectedValue} />
          ) : (
            <FieldIcon
              size={14}
              className="shrink-0 text-[rgb(var(--app-muted))]"
            />
          )}
          <span className="truncate">{displayValue}</span>
        </span>
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu aria-label={`Filtrar por ${definition.label}`}>
          <Dropdown.Item
            id={`${definition.key}:all`}
            onPress={() => onChange(definition.key, "all")}
          >
            <span className="flex items-center gap-2">
              <FieldIcon
                size={14}
                className="shrink-0 text-[rgb(var(--app-muted))]"
              />
              <span>Todos · {definition.label}</span>
            </span>
          </Dropdown.Item>
          {definition.options.map((option) => (
            <Dropdown.Item
              id={`${definition.key}:${option}`}
              key={option}
              onPress={() => onChange(definition.key, option)}
            >
              {definition.key === "status" ? (
                <span className="flex items-center gap-2">
                  <ProjectStatusIcon value={option} />
                  <span>{option}</span>
                </span>
              ) : definition.key === "priority" ? (
                <span className="flex items-center gap-2">
                  <ProjectPriorityIcon value={option} />
                  <span>{option}</span>
                </span>
              ) : (
                option
              )}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function DashboardFilterBar({
  hasActiveFilters,
  projectFieldFilters,
  search,
  selectedProjectFields,
  selectedState,
  onClearFilters,
  onProjectFieldChange,
  onSearchChange,
  onStateChange,
}: DashboardFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 py-1.5 shadow-sm backdrop-blur">
      <div className="flex flex-1 flex-wrap items-center gap-2.5">
        <div className="relative flex min-w-[200px] max-w-md flex-1 items-center">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 z-10 text-[rgb(var(--app-muted))]"
          />
          <Input
            aria-label="Buscar issue o repositorio"
            placeholder="Buscar por título, #issue o repositorio..."
            value={search}
            className="w-full pl-8 pr-8"
            onChange={(event) => onSearchChange(event.target.value)}
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

        <div className="flex flex-wrap items-center gap-2">
          <Dropdown>
            <Dropdown.Trigger className="button button--sm button--outline rounded-[0.8rem] px-2.5">
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <StateIcon value={selectedState} />
                <span>{getStateLabel(selectedState)}</span>
              </span>
            </Dropdown.Trigger>
            <Dropdown.Popover>
              <Dropdown.Menu aria-label="Filtrar por estado de la issue">
                {(["all", "open", "closed"] as const).map((state) => (
                  <Dropdown.Item
                    id={`issue-state:${state}`}
                    key={state}
                    onPress={() => onStateChange(state)}
                  >
                    <div className="flex items-center gap-2">
                      <StateIcon value={state} />
                      <span>{getStateLabel(state)}</span>
                    </div>
                  </Dropdown.Item>
                ))}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>

          {projectFieldFilters.map((definition) => (
            <ProjectFieldDropdown
              definition={definition}
              key={definition.key}
              selectedValue={selectedProjectFields[definition.key] ?? "all"}
              onChange={onProjectFieldChange}
            />
          ))}
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
