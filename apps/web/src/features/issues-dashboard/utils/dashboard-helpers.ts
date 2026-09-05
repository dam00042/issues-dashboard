import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  MinusCircle,
} from "lucide-react";
import {
  normalizeProjectPriorityValue,
  PROJECT_PRIORITY_DEFINITIONS,
} from "@/features/issues-dashboard/project-priorities";
import {
  compareProjectStatusValues,
  getProjectStatusLabel,
  normalizeProjectStatusValue,
} from "@/features/issues-dashboard/project-statuses";
import type {
  DashboardIssue,
  NoteBlock,
  NoteBlockItem,
  NoteBlockKind,
  PriorityDefinition,
  ProjectFilterDefinition,
  RemoteIssueStateFilter,
  SelectedProjectFields,
  SyncStateItem,
  ThemeDefinition,
} from "@/features/issues-dashboard/types";

const CONTEXT_BLOCK_ID = "context";
const NEXT_ACTION_BLOCK_ID = "next-action";
const CONTEXT_ITEM_ID = "context-item-1";
const NEXT_ACTION_ITEM_ID = "next-action-item-1";
const PROJECT_FILTER_FIELDS = [
  { key: "status", label: "Status de Projects" },
  { key: "sprint", label: "Sprint" },
  { key: "priority", label: "Priority" },
] as const;

type LegacyNoteBlock = Partial<NoteBlock> & {
  kind?: NoteBlockKind;
  text?: string;
};

export const PRIORITY_DEFINITIONS: PriorityDefinition[] = [
  {
    accentClassName: "text-[#f85149]",
    buttonClassName:
      "border-[#f85149]/35 bg-[rgba(248,81,73,0.14)] text-[#f85149] hover:border-[#f85149]/55 hover:bg-[rgba(248,81,73,0.2)]",
    color: "#f85149",
    headerClassName: "border-b border-[rgb(var(--app-border))]/55",
    icon: AlertTriangle,
    label: "Urgente",
    tint: "rgba(248, 81, 73, 0.12)",
    tooltipClassName:
      "border border-[#f85149]/25 bg-[rgb(var(--app-surface))] text-[#f85149] shadow-lg shadow-black/20",
    value: 4,
  },
  {
    accentClassName: "text-[#d97706]",
    buttonClassName:
      "border-[#d97706]/35 bg-[rgba(217,119,6,0.14)] text-[#d97706] hover:border-[#d97706]/55 hover:bg-[rgba(217,119,6,0.2)]",
    color: "#d97706",
    headerClassName: "border-b border-[rgb(var(--app-border))]/55",
    icon: ArrowUpCircle,
    label: "Alta",
    tint: "rgba(217, 119, 6, 0.1)",
    tooltipClassName:
      "border border-[#d97706]/25 bg-[rgb(var(--app-surface))] text-[#d97706] shadow-lg shadow-black/20",
    value: 3,
  },
  {
    accentClassName: "text-[#2563eb]",
    buttonClassName:
      "border-[#2563eb]/35 bg-[rgba(37,99,235,0.14)] text-[#2563eb] hover:border-[#2563eb]/55 hover:bg-[rgba(37,99,235,0.2)]",
    color: "#2563eb",
    headerClassName: "border-b border-[rgb(var(--app-border))]/55",
    icon: MinusCircle,
    label: "Media",
    tint: "rgba(37, 99, 235, 0.1)",
    tooltipClassName:
      "border border-[#2563eb]/25 bg-[rgb(var(--app-surface))] text-[#2563eb] shadow-lg shadow-black/20",
    value: 2,
  },
  {
    accentClassName: "text-[#6b7280]",
    buttonClassName:
      "border-[#6b7280]/35 bg-[rgba(107,114,128,0.14)] text-[#9ca3af] hover:border-[#6b7280]/55 hover:bg-[rgba(107,114,128,0.2)]",
    color: "#6b7280",
    headerClassName: "border-b border-[rgb(var(--app-border))]/55",
    icon: ArrowDownCircle,
    label: "Baja",
    tint: "rgba(107, 114, 128, 0.1)",
    tooltipClassName:
      "border border-[#6b7280]/25 bg-[rgb(var(--app-surface))] text-[#9ca3af] shadow-lg shadow-black/20",
    value: 1,
  },
];

export const THEME_DEFINITIONS: ThemeDefinition[] = [
  { label: "Sistema", value: "system" },
  { label: "Claro", value: "light" },
  { label: "Oscuro", value: "dark" },
];

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeNoteKind(rawKind: string | undefined): NoteBlockKind {
  if (rawKind === "checklist" || rawKind === "ordered" || rawKind === "text") {
    return rawKind;
  }

  return "text";
}

function createNoteItem(
  kind: NoteBlockKind = "text",
  text = "",
  checked = false,
): NoteBlockItem {
  return {
    checked,
    id: createLocalId("item"),
    kind,
    text,
  };
}

function splitLegacyText(text: string): NoteBlockItem[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return [];
  }

  return lines.map((line) => createNoteItem("text", line));
}

function resolveNoteSectionIndex(
  block: LegacyNoteBlock,
  index: number,
): number {
  const normalizedId = String(block.id ?? "")
    .trim()
    .toLowerCase();
  const normalizedLabel = String(block.label ?? "")
    .trim()
    .toLowerCase();

  if (
    normalizedId === CONTEXT_BLOCK_ID ||
    normalizedLabel.includes("context")
  ) {
    return 0;
  }

  if (
    normalizedId === NEXT_ACTION_BLOCK_ID ||
    normalizedLabel.includes("siguient")
  ) {
    return 1;
  }

  return index === 0 ? 0 : 1;
}

function normalizeNoteItems(block: LegacyNoteBlock): NoteBlockItem[] {
  const fallbackKind = normalizeNoteKind(block.kind);
  const rawItems = Array.isArray(block.items) ? block.items : [];
  const normalizedItems = rawItems.map((item) => {
    const normalizedText = String(item?.text ?? "");
    const normalizedKind = normalizeNoteKind(
      "kind" in item ? String(item.kind ?? "") : fallbackKind,
    );

    return {
      checked: Boolean(item?.checked),
      id: String(item?.id ?? createLocalId("item")),
      kind: normalizedKind,
      text: normalizedText,
    } satisfies NoteBlockItem;
  });

  if (normalizedItems.length > 0) {
    return normalizedItems;
  }

  if (typeof block.text === "string" && block.text.trim().length > 0) {
    return splitLegacyText(block.text);
  }

  return [];
}

export function defaultNoteBlocks(): NoteBlock[] {
  return [
    {
      id: CONTEXT_BLOCK_ID,
      items: [{ ...createNoteItem(), id: CONTEXT_ITEM_ID }],
      label: "Contexto",
    },
    {
      id: NEXT_ACTION_BLOCK_ID,
      items: [{ ...createNoteItem("checklist"), id: NEXT_ACTION_ITEM_ID }],
      label: "Siguientes pasos",
    },
  ];
}

export function createNoteLine(kind: NoteBlockKind = "text"): NoteBlockItem {
  return createNoteItem(kind);
}

export function normalizeNoteBlocks(
  blocks: NoteBlock[] | undefined,
): NoteBlock[] {
  const defaults = defaultNoteBlocks();
  const mergedBlocks = defaults.map((block) => ({
    ...block,
    items: [] as NoteBlockItem[],
  }));

  for (const [index, rawBlock] of (blocks ?? []).entries()) {
    const block = rawBlock as LegacyNoteBlock;
    const sectionIndex = resolveNoteSectionIndex(block, index);
    const normalizedItems = normalizeNoteItems(block).map(
      (item): NoteBlockItem =>
        sectionIndex === 1 &&
        item.id === NEXT_ACTION_ITEM_ID &&
        item.kind === "text" &&
        !item.text.trim()
          ? { ...item, kind: "checklist" }
          : item,
    );

    if (normalizedItems.length === 0) {
      continue;
    }

    mergedBlocks[sectionIndex]?.items.push(...normalizedItems);
  }

  return mergedBlocks.map((block, index) => {
    const fallbackBlock = defaults[index] ??
      defaults[0] ?? {
        id: block.id,
        items: [createNoteItem()],
        label: block.label,
      };

    return {
      id: block.id,
      items: block.items.length > 0 ? block.items : fallbackBlock.items,
      label: fallbackBlock.label,
    };
  });
}

export function hasMeaningfulNotes(blocks: NoteBlock[]): boolean {
  return blocks.some((block) =>
    block.items.some((item) => item.text.trim().length > 0 || item.checked),
  );
}

export function getPriorityDefinition(
  priority: DashboardIssue["localState"]["priority"],
): PriorityDefinition | null {
  return (
    PRIORITY_DEFINITIONS.find((definition) => definition.value === priority) ??
    null
  );
}

export function sortIssuesByPinnedAndUpdated(
  issues: DashboardIssue[],
): DashboardIssue[] {
  return [...issues].sort((left, right) => {
    if (left.localState.isPinned !== right.localState.isPinned) {
      return left.localState.isPinned ? -1 : 1;
    }

    const leftUpdatedAt = Date.parse(
      left.updatedAt ?? left.createdAt ?? left.syncedAt,
    );
    const rightUpdatedAt = Date.parse(
      right.updatedAt ?? right.createdAt ?? right.syncedAt,
    );

    return rightUpdatedAt - leftUpdatedAt;
  });
}

export function filterIssuesBySearch(
  issues: DashboardIssue[],
  search: string,
): DashboardIssue[] {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return issues;
  }

  return issues.filter((issue) => {
    const haystack =
      `${issue.title} ${issue.repository.fullName} ${issue.repository.name} ${issue.number}`.toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

export function issueMatchesRemoteState(
  issue: DashboardIssue,
  selectedState: RemoteIssueStateFilter,
): boolean {
  return selectedState === "all" || issue.remoteState === selectedState;
}

export function normalizeProjectFieldKey(fieldName: string): string {
  return fieldName.trim().toLocaleLowerCase("es");
}

function normalizeProjectFieldValue(fieldKey: string, value: string): string {
  if (fieldKey === "status") return normalizeProjectStatusValue(value);
  if (fieldKey === "priority") return normalizeProjectPriorityValue(value);
  if (fieldKey === "sprint") {
    return value
      .replace(/\s*\(current\)\s*$/i, "")
      .trim()
      .toLocaleLowerCase("es");
  }
  return value.trim().toLocaleLowerCase("es");
}

function getProjectFieldDisplayValue(fieldKey: string, value: string): string {
  if (fieldKey !== "status") return value.trim();
  return getProjectStatusLabel(value);
}

export function buildProjectFilterDefinitions(
  issues: DashboardIssue[],
): ProjectFilterDefinition[] {
  const optionsByField = new Map<string, Map<string, string>>();

  for (const issue of issues) {
    for (const projectItem of issue.projectItems ?? []) {
      for (const field of projectItem.fields) {
        const key = normalizeProjectFieldKey(field.fieldName);
        if (
          !PROJECT_FILTER_FIELDS.some((definition) => definition.key === key) ||
          !field.value
        ) {
          continue;
        }
        const options = optionsByField.get(key) ?? new Map<string, string>();
        const normalizedValue = normalizeProjectFieldValue(key, field.value);
        if (!options.has(normalizedValue)) {
          options.set(
            normalizedValue,
            getProjectFieldDisplayValue(key, field.value),
          );
        }
        optionsByField.set(key, options);
      }
    }
  }

  return PROJECT_FILTER_FIELDS.flatMap(
    (definition): ProjectFilterDefinition[] => {
      const options = optionsByField.get(definition.key);
      if (!options?.size) return [];
      if (definition.key === "priority") {
        return [
          {
            ...definition,
            options: PROJECT_PRIORITY_DEFINITIONS.map(({ label }) => label),
          },
        ];
      }

      if (definition.key === "sprint") {
        const sortedSprints = [...options.values()].sort((left, right) =>
          right.localeCompare(left, "es", {
            numeric: true,
            sensitivity: "base",
          }),
        );
        return [
          {
            ...definition,
            options: sortedSprints.map((sprint, index) =>
              index === 0 ? `${sprint} (Current)` : sprint,
            ),
          },
        ];
      }

      return [
        {
          ...definition,
          options: [...options.values()].sort(compareProjectStatusValues),
        },
      ];
    },
  );
}

export function issueMatchesProjectFilters(
  issue: DashboardIssue,
  selectedFields: SelectedProjectFields,
): boolean {
  return Object.entries(selectedFields).every(
    ([selectedKey, selectedValue]) => {
      if (!selectedValue || selectedValue === "all") return true;
      return (issue.projectItems ?? []).some((projectItem) =>
        projectItem.fields.some(
          (field) =>
            normalizeProjectFieldKey(field.fieldName) === selectedKey &&
            normalizeProjectFieldValue(selectedKey, field.value) ===
              normalizeProjectFieldValue(selectedKey, selectedValue),
        ),
      );
    },
  );
}

export function buildSyncPayload(
  issues: DashboardIssue[],
  dirtyIssueKeys: Iterable<string>,
): SyncStateItem[] {
  const dirtyKeySet = new Set(dirtyIssueKeys);

  return issues
    .filter((issue) => dirtyKeySet.has(issue.issueKey))
    .map((issue) => ({
      githubId: issue.githubId,
      issueKey: issue.issueKey,
      issueNumber: issue.number,
      repoFullName: issue.repository.fullName,
      repoName: issue.repository.name,
      state: issue.localState,
    }));
}

export function formatAbsoluteTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return "sin actividad reciente";
  }

  return format(new Date(timestamp), "dd/MM/yyyy HH:mm", { locale: es });
}

export function formatRelativeTimestamp(timestamp: string | null): string {
  if (!timestamp) {
    return "sin actividad reciente";
  }

  return new Intl.RelativeTimeFormat("es", { numeric: "auto" }).format(
    -Math.max(1, Math.round((Date.now() - Date.parse(timestamp)) / 86_400_000)),
    "day",
  );
}

export function getRemoteStateDotClassName(
  remoteState: DashboardIssue["remoteState"],
): string {
  return remoteState === "open"
    ? "bg-[rgb(var(--app-open))]"
    : "bg-[rgb(var(--app-closed))]";
}
