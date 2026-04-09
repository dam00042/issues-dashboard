"use client";

import { Button, Checkbox, Dropdown, Tooltip } from "@heroui/react";
import {
  CheckSquare2,
  ListOrdered,
  type LucideIcon,
  Rows3,
  Trash2,
} from "lucide-react";
import {
  type Key,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createNoteLine,
  normalizeNoteBlocks,
} from "@/features/issues-dashboard/dashboard-helpers";
import type {
  NoteBlock,
  NoteBlockItem,
  NoteBlockKind,
} from "@/features/issues-dashboard/types";

interface NotesBlockEditorProps {
  blocks: NoteBlock[];
  onBlocksChange: (nextBlocks: NoteBlock[]) => void;
}

interface NoteKindDefinition {
  icon: LucideIcon;
  label: string;
  spacerClassName: string;
}

const NOTE_KIND_DEFINITIONS: Record<NoteBlockKind, NoteKindDefinition> = {
  checklist: {
    icon: CheckSquare2,
    label: "Checklist",
    spacerClassName: "text-[rgb(var(--app-border))]",
  },
  ordered: {
    icon: ListOrdered,
    label: "Lista numerada",
    spacerClassName: "text-[rgb(var(--app-muted))]",
  },
  text: {
    icon: Rows3,
    label: "Texto",
    spacerClassName: "text-[rgb(var(--app-border))]",
  },
};

const NOTE_KIND_ENTRIES = Object.entries(NOTE_KIND_DEFINITIONS) as [
  NoteBlockKind,
  NoteKindDefinition,
][];
const NOTE_COMMIT_DEBOUNCE_MS = 900;
const NOTE_TEXTAREA_BASE_CLASS =
  "min-h-[3.25rem] w-full resize-y overflow-hidden rounded-[0.82rem] border border-[rgb(var(--app-border))]/55 bg-[rgb(var(--app-surface))]/95 px-3 py-2.5 text-sm leading-6 text-[rgb(var(--app-foreground))] shadow-none outline-none transition-colors placeholder:text-[rgb(var(--app-muted))]/70 focus:border-[rgb(var(--app-accent))]/45 focus:bg-[rgb(var(--app-surface))] focus:outline-none";
const NOTE_TEXTAREA_CHECKED_CLASS =
  "border-[rgb(var(--app-border))]/75 bg-[rgb(var(--app-muted))]/8 text-[rgb(var(--app-muted))]/78 line-through decoration-2 decoration-[rgb(var(--app-muted))]/78";

function resizeInput(inputElement: HTMLTextAreaElement) {
  inputElement.style.height = "0px";
  inputElement.style.height = `${Math.max(inputElement.scrollHeight, 52)}px`;
}

function serializeBlocks(blocks: NoteBlock[]): string {
  return JSON.stringify(blocks);
}

export function NotesBlockEditor({
  blocks,
  onBlocksChange,
}: NotesBlockEditorProps) {
  const normalizedBlocks = normalizeNoteBlocks(blocks);
  const [draftBlocks, setDraftBlocks] = useState<NoteBlock[]>(normalizedBlocks);
  const inputRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const commitTimeoutRef = useRef<number | null>(null);
  const draftBlocksRef = useRef<NoteBlock[]>(normalizedBlocks);
  const onBlocksChangeRef = useRef(onBlocksChange);
  const lastCommittedSignatureRef = useRef(serializeBlocks(normalizedBlocks));
  const [pendingFocusItemId, setPendingFocusItemId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    onBlocksChangeRef.current = onBlocksChange;
  }, [onBlocksChange]);

  useEffect(() => {
    const nextSignature = serializeBlocks(normalizedBlocks);

    if (nextSignature === lastCommittedSignatureRef.current) {
      return;
    }

    lastCommittedSignatureRef.current = nextSignature;
    draftBlocksRef.current = normalizedBlocks;
    setDraftBlocks(normalizedBlocks);
  }, [normalizedBlocks]);

  useEffect(() => {
    if (!pendingFocusItemId) {
      return;
    }

    const inputElement = inputRefs.current.get(pendingFocusItemId);

    if (!inputElement) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      inputElement.focus();
      inputElement.setSelectionRange(
        inputElement.value.length,
        inputElement.value.length,
      );
      setPendingFocusItemId(null);
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [pendingFocusItemId]);

  useEffect(() => {
    return () => {
      if (commitTimeoutRef.current === null) {
        return;
      }

      window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
      onBlocksChangeRef.current(draftBlocksRef.current);
    };
  }, []);

  function setInputRef(
    itemId: string,
    inputElement: HTMLTextAreaElement | null,
  ) {
    if (inputElement) {
      inputRefs.current.set(itemId, inputElement);
      window.requestAnimationFrame(() => {
        resizeInput(inputElement);
      });
      return;
    }

    inputRefs.current.delete(itemId);
  }

  function clearPendingCommit() {
    if (commitTimeoutRef.current === null) {
      return;
    }

    window.clearTimeout(commitTimeoutRef.current);
    commitTimeoutRef.current = null;
  }

  function commitBlocks(nextBlocks: NoteBlock[]) {
    const normalizedNextBlocks = normalizeNoteBlocks(nextBlocks);
    const nextSignature = serializeBlocks(normalizedNextBlocks);

    clearPendingCommit();
    draftBlocksRef.current = normalizedNextBlocks;
    lastCommittedSignatureRef.current = nextSignature;
    onBlocksChangeRef.current(normalizedNextBlocks);
  }

  function scheduleCommit(nextBlocks: NoteBlock[]) {
    const normalizedNextBlocks = normalizeNoteBlocks(nextBlocks);
    const nextSignature = serializeBlocks(normalizedNextBlocks);

    clearPendingCommit();
    draftBlocksRef.current = normalizedNextBlocks;
    commitTimeoutRef.current = window.setTimeout(() => {
      commitTimeoutRef.current = null;
      lastCommittedSignatureRef.current = nextSignature;
      onBlocksChangeRef.current(normalizedNextBlocks);
    }, NOTE_COMMIT_DEBOUNCE_MS);
  }

  function flushPendingCommit() {
    if (commitTimeoutRef.current === null) {
      return;
    }

    commitBlocks(draftBlocksRef.current);
  }

  function applyBlocks(
    nextBlocks: NoteBlock[],
    mode: "debounced" | "immediate",
  ) {
    const normalizedNextBlocks = normalizeNoteBlocks(nextBlocks);
    draftBlocksRef.current = normalizedNextBlocks;
    setDraftBlocks(normalizedNextBlocks);
    window.requestAnimationFrame(() => {
      for (const inputElement of inputRefs.current.values()) {
        resizeInput(inputElement);
      }
    });

    if (mode === "immediate") {
      commitBlocks(normalizedNextBlocks);
      return;
    }

    scheduleCommit(normalizedNextBlocks);
  }

  function updateBlockItems(
    blockId: string,
    updater: (items: NoteBlockItem[]) => NoteBlockItem[],
    mode: "debounced" | "immediate" = "debounced",
  ) {
    const nextBlocks = draftBlocksRef.current.map((block) =>
      block.id === blockId
        ? {
            ...block,
            items: updater(block.items),
          }
        : block,
    );

    applyBlocks(nextBlocks, mode);
  }

  function updateItem(
    blockId: string,
    itemId: string,
    updater: (item: NoteBlockItem) => NoteBlockItem,
    mode: "debounced" | "immediate" = "debounced",
  ) {
    updateBlockItems(
      blockId,
      (items) =>
        items.map((item) => (item.id === itemId ? updater(item) : item)),
      mode,
    );
  }

  function insertItemAfter(
    blockId: string,
    itemId: string,
    kind: NoteBlockKind,
  ) {
    const nextItem = createNoteLine(kind);
    setPendingFocusItemId(nextItem.id);

    updateBlockItems(blockId, (items) => {
      const currentIndex = items.findIndex((item) => item.id === itemId);
      const insertIndex = currentIndex >= 0 ? currentIndex + 1 : items.length;

      return [
        ...items.slice(0, insertIndex),
        nextItem,
        ...items.slice(insertIndex),
      ];
    });
  }

  function removeItem(
    blockId: string,
    itemId: string,
    nextFocusItemId: string | null = null,
  ) {
    setPendingFocusItemId(nextFocusItemId);
    updateBlockItems(
      blockId,
      (items) =>
        items.length > 1 ? items.filter((item) => item.id !== itemId) : items,
      "immediate",
    );
  }

  function setItemKind(blockId: string, itemId: string, selectionKey: Key) {
    const nextKind = String(selectionKey) as NoteBlockKind;
    updateItem(
      blockId,
      itemId,
      (item) => ({
        ...item,
        checked: nextKind === "checklist" ? item.checked : false,
        kind: nextKind,
      }),
      "immediate",
    );
  }

  function handleItemKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    blockId: string,
    itemId: string,
    itemIndex: number,
    item: NoteBlockItem,
    blockItems: NoteBlockItem[],
  ) {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      insertItemAfter(blockId, itemId, item.kind);
      return;
    }

    const isCaretAtStart =
      event.currentTarget.selectionStart === 0 &&
      event.currentTarget.selectionEnd === 0;

    if (
      event.key === "Backspace" &&
      item.text.length === 0 &&
      !item.checked &&
      isCaretAtStart &&
      blockItems.length > 1
    ) {
      event.preventDefault();
      removeItem(
        blockId,
        itemId,
        blockItems[itemIndex - 1]?.id ?? blockItems[itemIndex + 1]?.id ?? null,
      );
    }
  }

  return (
    <div className="flex min-h-full flex-col gap-3">
      {draftBlocks.map((block) => (
        <section
          key={block.id}
          className="flex flex-col overflow-hidden rounded-[1.02rem] border border-[rgb(var(--app-border))]/60 bg-[rgb(var(--app-surface-strong))]/86"
        >
          <div className="border-b border-[rgb(var(--app-border))]/50 px-2.5 py-1.5">
            <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--app-muted))]">
              {block.label}
            </h3>
          </div>

          <div className="px-2 py-1.5">
            {block.items.map((item, itemIndex) => {
              const kindDefinition = NOTE_KIND_DEFINITIONS[item.kind];
              const KindIcon = kindDefinition.icon;
              const orderedItemIndex =
                block.items
                  .slice(0, itemIndex + 1)
                  .filter((currentItem) => currentItem.kind === "ordered")
                  .length ?? 0;

              return (
                <div
                  key={item.id}
                  className="group flex items-center gap-2 border-b border-[rgb(var(--app-border))]/38 py-1.5 last:border-b-0"
                >
                  <div className="flex shrink-0 items-center self-stretch pr-0.5">
                    {item.kind === "checklist" ? (
                      <Checkbox
                        aria-label={`Marcar ${block.label} ${itemIndex + 1}`}
                        className="group flex min-h-[3.25rem] w-4 shrink-0 items-center justify-center"
                        isSelected={item.checked}
                        onChange={(isSelected) =>
                          updateItem(
                            block.id,
                            item.id,
                            (currentItem) => ({
                              ...currentItem,
                              checked: isSelected,
                            }),
                            "immediate",
                          )
                        }
                      >
                        <Checkbox.Control className="flex h-4 w-4 items-center justify-center rounded-[0.38rem] border border-[rgb(var(--app-border))]/75 bg-[rgb(var(--app-surface))]/98 transition-colors group-data-[selected=true]:border-[rgb(var(--app-border))]/85 group-data-[selected=true]:bg-[rgb(var(--app-muted))]/10" />
                      </Checkbox>
                    ) : item.kind === "ordered" ? (
                      <span className="inline-flex min-h-[3.25rem] w-4 shrink-0 items-center justify-center text-xs font-semibold text-[rgb(var(--app-muted))]">
                        {orderedItemIndex}.
                      </span>
                    ) : (
                      <span
                        className={`inline-flex min-h-[3.25rem] w-4 shrink-0 items-center justify-center text-xs ${kindDefinition.spacerClassName}`}
                      >
                        {"\u2022"}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <textarea
                      aria-label={`${block.label} ${itemIndex + 1}`}
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      className={`${NOTE_TEXTAREA_BASE_CLASS} ${
                        item.checked ? NOTE_TEXTAREA_CHECKED_CLASS : ""
                      }`}
                      data-enable-grammarly="false"
                      data-gramm="false"
                      data-gramm_editor="false"
                      data-lt-active="false"
                      placeholder="Escribe aquí y pulsa Enter para añadir otra línea"
                      ref={(inputElement) => setInputRef(item.id, inputElement)}
                      rows={1}
                      spellCheck={false}
                      value={item.text}
                      onBlur={() => flushPendingCommit()}
                      onChange={(event) => {
                        resizeInput(event.currentTarget);
                        updateItem(block.id, item.id, (currentItem) => ({
                          ...currentItem,
                          text: event.currentTarget.value,
                        }));
                      }}
                      onKeyDown={(event) =>
                        handleItemKeyDown(
                          event,
                          block.id,
                          item.id,
                          itemIndex,
                          item,
                          block.items,
                        )
                      }
                    />
                  </div>

                  <div className="flex shrink-0 flex-col items-center justify-center gap-1 self-stretch">
                    <Dropdown>
                      <Dropdown.Trigger className="button button--icon-only button--sm button--ghost h-7 w-7 rounded-[0.75rem] border border-[rgb(var(--app-border))]/45 bg-[rgb(var(--app-surface))]/84 text-[rgb(var(--app-muted))] transition hover:border-[rgb(var(--app-border))]/70 hover:bg-[rgb(var(--app-surface))] hover:text-[rgb(var(--app-foreground))]">
                        <KindIcon size={14} />
                      </Dropdown.Trigger>
                      <Dropdown.Popover>
                        <Dropdown.Menu
                          aria-label="Tipo de línea"
                          onAction={(selectionKey) =>
                            setItemKind(block.id, item.id, selectionKey)
                          }
                        >
                          {NOTE_KIND_ENTRIES.map(([kind, definition]) => {
                            const MenuIcon = definition.icon;

                            return (
                              <Dropdown.Item
                                key={kind}
                                id={kind}
                                textValue={definition.label}
                              >
                                <div className="flex items-center gap-2">
                                  <MenuIcon size={14} />
                                  <span>{definition.label}</span>
                                </div>
                              </Dropdown.Item>
                            );
                          })}
                        </Dropdown.Menu>
                      </Dropdown.Popover>
                    </Dropdown>

                    <Tooltip closeDelay={0} delay={120}>
                      <Tooltip.Trigger>
                        <div className="inline-flex">
                          <Button
                            isIconOnly
                            aria-label="Eliminar línea"
                            size="sm"
                            variant="ghost"
                            isDisabled={block.items.length === 1}
                            className="h-7 w-7 rounded-[0.75rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-danger))]/10 hover:text-[rgb(var(--app-danger))]"
                            onPress={() =>
                              removeItem(
                                block.id,
                                item.id,
                                block.items[itemIndex - 1]?.id ??
                                  block.items[itemIndex + 1]?.id ??
                                  null,
                              )
                            }
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </Tooltip.Trigger>
                      <Tooltip.Content showArrow>
                        {block.items.length === 1
                          ? "Mantén al menos una línea"
                          : "Eliminar línea"}
                      </Tooltip.Content>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
