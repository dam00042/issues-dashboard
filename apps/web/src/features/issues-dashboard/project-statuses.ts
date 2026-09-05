export type ProjectStatusIconName =
  | "archive"
  | "badge-check"
  | "circle-check"
  | "circle-stop"
  | "construction"
  | "flask"
  | "history"
  | "list-todo"
  | "rocket"
  | "scan-eye"
  | "server";

export interface ProjectStatusDefinition {
  aliases: readonly string[];
  icon: ProjectStatusIconName;
  key: string;
  label: string;
}

export const PROJECT_STATUS_DEFINITIONS = [
  {
    aliases: ["backlog"],
    icon: "archive",
    key: "backlog",
    label: "Backlog",
  },
  {
    aliases: ["to do", "todo", "to-do", "to_do"],
    icon: "list-todo",
    key: "to-do",
    label: "To Do",
  },
  {
    aliases: ["stopped"],
    icon: "circle-stop",
    key: "stopped",
    label: "Stopped",
  },
  {
    aliases: ["in progress", "inprogress", "in-progress", "in_progress"],
    icon: "construction",
    key: "in-progress",
    label: "In Progress",
  },
  {
    aliases: ["in review", "inreview", "in-review", "in_review"],
    icon: "scan-eye",
    key: "in-review",
    label: "In Review",
  },
  {
    aliases: ["approved"],
    icon: "badge-check",
    key: "approved",
    label: "Approved",
  },
  {
    aliases: ["develop", "development"],
    icon: "rocket",
    key: "develop",
    label: "Develop",
  },
  {
    aliases: [
      "integration (qa)",
      "integration qa",
      "integration-qa",
      "integration_qa",
    ],
    icon: "flask",
    key: "integration-qa",
    label: "Integration (QA)",
  },
  {
    aliases: ["production"],
    icon: "server",
    key: "production",
    label: "Production",
  },
  {
    aliases: ["done"],
    icon: "circle-check",
    key: "done",
    label: "Done",
  },
  {
    aliases: ["second life", "secondlife", "second-life", "second_life"],
    icon: "history",
    key: "second-life",
    label: "Second Life",
  },
] as const satisfies readonly ProjectStatusDefinition[];

export function stripProjectStatusDecoration(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N})]+$/u, "")
    .replace(/\s+/gu, " ");
}

function normalizeStatusText(value: string): string {
  return stripProjectStatusDecoration(value)
    .toLocaleLowerCase("es")
    .replace(/[()[\]{}]/gu, " ")
    .replace(/[_/-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const STATUS_BY_ALIAS = new Map<string, ProjectStatusDefinition>();
const STATUS_ORDER = new Map<string, number>();

for (const [index, definition] of PROJECT_STATUS_DEFINITIONS.entries()) {
  STATUS_ORDER.set(definition.key, index);
  for (const alias of definition.aliases) {
    STATUS_BY_ALIAS.set(normalizeStatusText(alias), definition);
  }
}

export function getProjectStatusDefinition(
  value: string,
): ProjectStatusDefinition | undefined {
  return STATUS_BY_ALIAS.get(normalizeStatusText(value));
}

export function normalizeProjectStatusValue(value: string): string {
  return getProjectStatusDefinition(value)?.key ?? normalizeStatusText(value);
}

export function getProjectStatusLabel(value: string): string {
  return (
    getProjectStatusDefinition(value)?.label ??
    stripProjectStatusDecoration(value)
  );
}

export function compareProjectStatusValues(
  left: string,
  right: string,
): number {
  const leftOrder =
    STATUS_ORDER.get(normalizeProjectStatusValue(left)) ??
    Number.MAX_SAFE_INTEGER;
  const rightOrder =
    STATUS_ORDER.get(normalizeProjectStatusValue(right)) ??
    Number.MAX_SAFE_INTEGER;

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return left.localeCompare(right, "es", { sensitivity: "base" });
}
