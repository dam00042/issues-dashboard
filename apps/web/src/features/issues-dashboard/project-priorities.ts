export type ProjectPriorityIconName =
  | "circle-alert"
  | "arrow-up-circle"
  | "minus-circle"
  | "arrow-down-circle";

export interface ProjectPriorityDefinition {
  aliases: readonly string[];
  icon: ProjectPriorityIconName;
  key: string;
  label: string;
}

export const PROJECT_PRIORITY_DEFINITIONS: readonly ProjectPriorityDefinition[] =
  [
    {
      aliases: ["critical", "urgent"],
      icon: "circle-alert",
      key: "critical",
      label: "Critical",
    },
    {
      aliases: ["high"],
      icon: "arrow-up-circle",
      key: "high",
      label: "High",
    },
    {
      aliases: ["medium"],
      icon: "minus-circle",
      key: "medium",
      label: "Medium",
    },
    {
      aliases: ["low"],
      icon: "arrow-down-circle",
      key: "low",
      label: "Low",
    },
  ];

function stripDecoration(value: string): string {
  return value
    .replace(/^\s*[^\p{L}\p{N}]+/u, "")
    .trim()
    .toLocaleLowerCase("en");
}

export function getProjectPriorityDefinition(
  value: string,
): ProjectPriorityDefinition | null {
  const normalized = stripDecoration(value);
  return (
    PROJECT_PRIORITY_DEFINITIONS.find((definition) =>
      definition.aliases.includes(normalized),
    ) ?? null
  );
}

export function normalizeProjectPriorityValue(value: string): string {
  return getProjectPriorityDefinition(value)?.key ?? stripDecoration(value);
}
