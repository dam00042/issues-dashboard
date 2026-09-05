"use client";

import { Button, Tooltip } from "@heroui/react";
import { List } from "lucide-react";

import type {
  DashboardIssue,
  PriorityDefinition,
  PriorityValue,
} from "@/features/issues-dashboard/types";
import { PRIORITY_DEFINITIONS } from "@/features/issues-dashboard/utils/dashboard-helpers";

function getPriorityButtonClassName(
  definition: PriorityDefinition,
  isActive: boolean,
): string {
  if (isActive) return definition.buttonClassName;
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

export function IssuePrioritySelector({
  issue,
  onSetPriority,
}: {
  issue: DashboardIssue;
  onSetPriority: (issueKey: string, priority: PriorityValue | null) => void;
}) {
  return (
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
                        issue.localState.priority === definition.value,
                      )}`}
                      onPress={() =>
                        onSetPriority(issue.issueKey, definition.value)
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
                    issue.localState.priority === null
                      ? "h-[1.95rem] w-full rounded-[0.82rem] border-[rgb(var(--app-accent))]/50 bg-[rgb(var(--app-accent))]/12 text-[rgb(var(--app-accent-strong))]"
                      : "h-[1.95rem] w-full rounded-[0.82rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/90 text-[rgb(var(--app-muted))] hover:border-[rgb(var(--app-accent))]/40 hover:bg-[rgb(var(--app-accent))]/8 hover:text-[rgb(var(--app-accent-strong))]"
                  }
                  onPress={() => onSetPriority(issue.issueKey, null)}
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
  );
}
