"use client";

import { Button, Input, Modal, Tooltip } from "@heroui/react";
import { Copy, Loader2, Maximize2, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { DashboardIssue } from "@/features/issues-dashboard/types";

export interface SessionFormState {
  token: string;
  username: string;
}

interface SessionScreenProps {
  errorMessage: string;
  form: SessionFormState;
  isEditing: boolean;
  isSaving: boolean;
  onCancel: () => void;
  onChange: (field: keyof SessionFormState, value: string) => void;
  onSave: () => void;
  topInset?: boolean;
}

interface DesktopTitleBarProps {
  className?: string;
  isMaximized?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onToggleMaximize?: () => void;
}

const markdownComponents: Components = {
  a: ({ children, href }) => (
    <a
      className="font-medium text-[rgb(var(--app-accent))] underline underline-offset-4"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-black/6 px-1.5 py-0.5 text-[0.92em] dark:bg-white/10">
      {children}
    </code>
  ),
  h1: ({ children }) => (
    <h1 className="text-lg font-semibold text-[rgb(var(--app-foreground))]">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-semibold text-[rgb(var(--app-foreground))]">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
      {children}
    </h3>
  ),
  li: ({ children }) => (
    <li className="leading-6 text-[rgb(var(--app-foreground))]">{children}</li>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-decimal space-y-2 pl-5 last:mb-0">{children}</ol>
  ),
  p: ({ children }) => (
    <p className="mb-4 leading-6 text-[rgb(var(--app-foreground))] last:mb-0">
      {children}
    </p>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-2xl bg-[rgb(var(--app-surface-strong))] p-4 text-sm last:mb-0">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-disc space-y-2 pl-5 last:mb-0">{children}</ul>
  ),
};

export function DesktopTitleBar({
  className,
  isMaximized,
  onClose,
  onMinimize,
  onToggleMaximize,
}: DesktopTitleBarProps) {
  const hasWindowControls = Boolean(onClose || onMinimize || onToggleMaximize);

  return (
    <div
      className={`[-webkit-app-region:drag] flex h-9 items-center justify-between rounded-[1rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/94 px-3 shadow-[0_10px_24px_-24px_rgba(0,0,0,0.35)] backdrop-blur ${className ?? ""}`}
    >
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--app-accent))]" />
        <p className="text-sm font-semibold text-[rgb(var(--app-foreground))]">
          Issues Dashboard
        </p>
      </div>

      {hasWindowControls ? (
        <div className="[-webkit-app-region:no-drag] flex items-center gap-0.5">
          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label="Minimizar ventana"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-foreground))]/8 hover:text-[rgb(var(--app-foreground))]"
                  onPress={onMinimize}
                >
                  <Minus size={14} />
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>Minimizar</Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label={
                    isMaximized ? "Restaurar ventana" : "Maximizar ventana"
                  }
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-muted))] transition hover:bg-[rgb(var(--app-foreground))]/8 hover:text-[rgb(var(--app-foreground))]"
                  onPress={onToggleMaximize}
                >
                  {isMaximized ? <Copy size={14} /> : <Maximize2 size={14} />}
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>
              {isMaximized ? "Restaurar" : "Maximizar"}
            </Tooltip.Content>
          </Tooltip>

          <Tooltip>
            <Tooltip.Trigger>
              <div className="inline-flex">
                <Button
                  isIconOnly
                  aria-label="Cerrar ventana"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 rounded-[0.7rem] text-[rgb(var(--app-danger))] transition hover:bg-[rgb(var(--app-danger))]/12"
                  onPress={onClose}
                >
                  <X size={14} />
                </Button>
              </div>
            </Tooltip.Trigger>
            <Tooltip.Content showArrow>Cerrar</Tooltip.Content>
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}

export function SessionScreen({
  errorMessage,
  form,
  isEditing,
  isSaving,
  onCancel,
  onChange,
  onSave,
  topInset = false,
}: SessionScreenProps) {
  return (
    <main
      className={`flex items-center justify-center p-4 ${
        topInset ? "min-h-[calc(100vh-4rem)] pt-2" : "min-h-screen"
      }`}
    >
      <div className="w-full max-w-xl rounded-[2rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]/95 p-6 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.4)] backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.26em] text-[rgb(var(--app-muted))]">
          Sesión GitHub
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[rgb(var(--app-foreground))]">
          {isEditing
            ? "Actualiza tus credenciales locales"
            : "Configura tu primera sesión"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-[rgb(var(--app-muted))]">
          El token se guardará cifrado localmente y solo se utilizará para
          cargar tus issues asignadas.
        </p>

        <div className="mt-6 space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[rgb(var(--app-foreground))]">
              Usuario de GitHub
            </p>
            <Input
              aria-label="Usuario de GitHub"
              autoCapitalize="off"
              autoComplete="username"
              autoCorrect="off"
              data-enable-grammarly="false"
              data-gramm="false"
              data-gramm_editor="false"
              data-lt-active="false"
              placeholder="tu-usuario"
              spellCheck={false}
              value={form.username}
              className="w-full"
              onChange={(event) => onChange("username", event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-[rgb(var(--app-foreground))]">
              Token de GitHub
            </p>
            <Input
              aria-label="Token de GitHub"
              autoCapitalize="off"
              autoComplete={isEditing ? "off" : "current-password"}
              autoCorrect="off"
              data-enable-grammarly="false"
              data-gramm="false"
              data-gramm_editor="false"
              data-lt-active="false"
              placeholder={
                isEditing ? "Déjalo vacío para conservar el actual" : "ghp_..."
              }
              spellCheck={false}
              type="password"
              value={form.token}
              className="w-full"
              onChange={(event) => onChange("token", event.target.value)}
            />
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-[rgb(var(--app-danger))]/35 bg-[rgb(var(--app-danger))]/10 px-4 py-3 text-sm text-[rgb(var(--app-danger))]">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          {isEditing ? (
            <Button variant="outline" onPress={onCancel}>
              Cancelar
            </Button>
          ) : null}

          <Button
            variant="primary"
            isDisabled={
              !form.username.trim() || (!isEditing && !form.token.trim())
            }
            onPress={onSave}
          >
            <span className="inline-flex items-center gap-2">
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : null}
              <span>Guardar sesión</span>
            </span>
          </Button>
        </div>
      </div>
    </main>
  );
}

interface IconActionButtonProps {
  children: ReactNode;
  isDisabled?: boolean;
  label: string;
  onPress?: () => void;
}

export function IconActionButton({
  children,
  isDisabled = false,
  label,
  onPress,
}: IconActionButtonProps) {
  return (
    <Tooltip closeDelay={0} delay={120}>
      <Tooltip.Trigger>
        <div className="inline-flex">
          <Button
            isIconOnly
            size="sm"
            variant="outline"
            isDisabled={isDisabled}
            className="h-8 w-8 rounded-[0.8rem] border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/92 text-[rgb(var(--app-muted))] shadow-none transition hover:border-[rgb(var(--app-accent))]/35 hover:text-[rgb(var(--app-foreground))]"
            onPress={onPress}
          >
            {children}
          </Button>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content
        showArrow
        className="border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]"
      >
        {label}
      </Tooltip.Content>
    </Tooltip>
  );
}

interface DescriptionModalProps {
  isOpen: boolean;
  issue: DashboardIssue | null;
  onOpenChange: (nextValue: boolean) => void;
}

export function DescriptionModal({
  isOpen,
  issue,
  onOpenChange,
}: DescriptionModalProps) {
  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        variant="blur"
        onOpenChange={onOpenChange}
      >
        <Modal.Container scroll="inside" size="md">
          <Modal.Dialog className="mx-auto h-[50vh] w-[50vw] max-w-none border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Descripción original</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="text-sm">
                <ReactMarkdown
                  components={markdownComponents}
                  remarkPlugins={[remarkGfm]}
                >
                  {issue?.body || "Esta issue no tiene descripción en GitHub."}
                </ReactMarkdown>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button slot="close" variant="outline">
                Cerrar
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
