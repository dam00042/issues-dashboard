"use client";

import { Button, Input } from "@heroui/react";
import { Loader2 } from "lucide-react";

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
              autoComplete="off"
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
                isEditing ? "Déjalo vacío para conservar el actual" : "gho_..."
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
