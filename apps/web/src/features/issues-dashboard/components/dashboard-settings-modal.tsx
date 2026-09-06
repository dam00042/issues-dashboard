"use client";

import { Button, Input, ListBox, Modal, Select, Switch } from "@heroui/react";
import { useEffect, useState } from "react";

import type {
  AutoRefreshUnit,
  DashboardPreferences,
  HistoryWindowUnit,
} from "@/features/issues-dashboard/types";

const MIN_REFRESH_MINUTES = 5;
const MAX_REFRESH_MINUTES = 24 * 24 * 60;
const UNIT_MINUTES: Record<AutoRefreshUnit, number> = {
  days: 24 * 60,
  hours: 60,
  minutes: 1,
};

interface DashboardSettingsModalProps {
  isOpen: boolean;
  isSaving: boolean;
  preferences: DashboardPreferences;
  onOpenChange: (isOpen: boolean) => void;
  onSave: (preferences: DashboardPreferences) => Promise<void>;
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/u.test(value.trim())) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

export function DashboardSettingsModal({
  isOpen,
  isSaving,
  preferences,
  onOpenChange,
  onSave,
}: DashboardSettingsModalProps) {
  const [closedAmount, setClosedAmount] = useState("1");
  const [closedUnit, setClosedUnit] = useState<HistoryWindowUnit>("months");
  const [closedUnlimited, setClosedUnlimited] = useState(false);
  const [pullRequestAmount, setPullRequestAmount] = useState("1");
  const [pullRequestUnit, setPullRequestUnit] =
    useState<HistoryWindowUnit>("months");
  const [refreshEnabled, setRefreshEnabled] = useState(false);
  const [refreshAmount, setRefreshAmount] = useState("5");
  const [refreshUnit, setRefreshUnit] = useState<AutoRefreshUnit>("minutes");
  const [validationError, setValidationError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setClosedAmount(String(preferences.closedIssueHistory.amount));
    setClosedUnit(preferences.closedIssueHistory.unit);
    setClosedUnlimited(preferences.closedIssueHistory.unlimited);
    setPullRequestAmount(String(preferences.pullRequestHistory.amount));
    setPullRequestUnit(preferences.pullRequestHistory.unit);
    setRefreshEnabled(preferences.autoRefresh.enabled);
    setRefreshAmount(String(preferences.autoRefresh.amount));
    setRefreshUnit(preferences.autoRefresh.unit);
    setValidationError("");
  }, [isOpen, preferences]);

  async function saveDraft() {
    const parsedClosedAmount = parsePositiveInteger(closedAmount);
    const parsedPullRequestAmount = parsePositiveInteger(pullRequestAmount);
    const parsedRefreshAmount = parsePositiveInteger(refreshAmount);
    if (!closedUnlimited && parsedClosedAmount === null) {
      setValidationError("El historial de issues debe ser un entero positivo.");
      return;
    }
    if (parsedPullRequestAmount === null) {
      setValidationError(
        "El historial de Pull Requests debe ser un entero positivo.",
      );
      return;
    }
    if (refreshEnabled && parsedRefreshAmount === null) {
      setValidationError("El intervalo debe ser un entero positivo.");
      return;
    }
    const refreshMinutes =
      (parsedRefreshAmount ?? preferences.autoRefresh.amount) *
      UNIT_MINUTES[refreshUnit];
    if (
      refreshEnabled &&
      (refreshMinutes < MIN_REFRESH_MINUTES ||
        refreshMinutes > MAX_REFRESH_MINUTES)
    ) {
      setValidationError("El intervalo debe estar entre 5 minutos y 24 días.");
      return;
    }

    setValidationError("");
    await onSave({
      ...preferences,
      autoRefresh: {
        amount: parsedRefreshAmount ?? preferences.autoRefresh.amount,
        enabled: refreshEnabled,
        unit: refreshUnit,
      },
      closedIssueHistory: {
        amount: parsedClosedAmount ?? preferences.closedIssueHistory.amount,
        unit: closedUnit,
        unlimited: closedUnlimited,
      },
      pullRequestHistory: {
        amount: parsedPullRequestAmount,
        unit: pullRequestUnit,
        unlimited: false,
      },
    });
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isSaving}
        isOpen={isOpen}
        variant="blur"
        onOpenChange={onOpenChange}
      >
        <Modal.Container size="lg">
          <Modal.Dialog className="w-[calc(100vw-2rem)] !max-w-[52rem] border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface))] text-[rgb(var(--app-foreground))]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Ajustes</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="grid gap-6 px-1 md:grid-cols-2">
                <section className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold">
                      Historial de issues cerradas
                    </p>
                    <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                      Las abiertas siempre se muestran; este límite solo afecta
                      a las cerradas.
                    </p>
                  </div>
                  <HistoryFields
                    amount={closedAmount}
                    disabled={closedUnlimited}
                    unit={closedUnit}
                    onAmountChange={(value) => {
                      setClosedAmount(value);
                      setValidationError("");
                    }}
                    onUnitChange={setClosedUnit}
                  />
                  <Switch
                    isSelected={closedUnlimited}
                    className="w-full justify-between gap-4 rounded-2xl border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/70 px-4 py-3"
                    onChange={setClosedUnlimited}
                  >
                    <Switch.Content className="min-w-0 text-left">
                      <span className="block text-sm font-medium">
                        Sin límite de antigüedad
                      </span>
                      <span className="mt-0.5 block text-xs text-[rgb(var(--app-muted))]">
                        Carga todas las issues cerradas disponibles.
                      </span>
                    </Switch.Content>
                    <Switch.Control className="shrink-0">
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch>
                </section>

                <section className="space-y-3 md:border-l md:border-[rgb(var(--app-border))]/70 md:pl-6">
                  <div>
                    <p className="text-sm font-semibold">
                      Historial de Pull Requests
                    </p>
                    <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                      Consulta y muestra solo PRs con actividad dentro de este
                      periodo.
                    </p>
                  </div>
                  <HistoryFields
                    amount={pullRequestAmount}
                    unit={pullRequestUnit}
                    onAmountChange={(value) => {
                      setPullRequestAmount(value);
                      setValidationError("");
                    }}
                    onUnitChange={setPullRequestUnit}
                  />
                </section>

                <section className="space-y-3 border-t border-[rgb(var(--app-border))]/70 pt-5 md:col-span-2">
                  <div>
                    <p className="text-sm font-semibold">
                      Actualización automática
                    </p>
                    <p className="mt-1 text-xs text-[rgb(var(--app-muted))]">
                      Sincroniza todo mientras la app esté visible. Se pausa en
                      segundo plano.
                    </p>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(15rem,1fr)_minmax(0,1fr)]">
                    <Switch
                      isSelected={refreshEnabled}
                      className="w-full justify-between gap-4 rounded-2xl border border-[rgb(var(--app-border))]/70 bg-[rgb(var(--app-surface-strong))]/70 px-4 py-3"
                      onChange={setRefreshEnabled}
                    >
                      <Switch.Content className="text-left">
                        <span className="block text-sm font-medium">
                          Activar refresco periódico
                        </span>
                        <span className="text-xs text-[rgb(var(--app-muted))]">
                          {refreshEnabled ? "Activado" : "Desactivado"}
                        </span>
                      </Switch.Content>
                      <Switch.Control className="shrink-0">
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                    <div
                      className={
                        refreshEnabled ? "" : "pointer-events-none opacity-50"
                      }
                    >
                      <RefreshFields
                        amount={refreshAmount}
                        unit={refreshUnit}
                        onAmountChange={(value) => {
                          setRefreshAmount(value);
                          setValidationError("");
                        }}
                        onUnitChange={setRefreshUnit}
                      />
                    </div>
                  </div>
                  <p className="text-xs text-[rgb(var(--app-muted))]">
                    Mínimo 5 minutos y máximo 24 días. Intervalos cortos
                    consumen antes la cuota de GitHub.
                  </p>
                </section>
                {validationError ? (
                  <p className="text-xs font-medium text-[rgb(var(--app-danger))] md:col-span-2">
                    {validationError}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isSaving}
                slot="close"
                variant="outline"
                onPress={() => onOpenChange(false)}
              >
                Cerrar
              </Button>
              <Button
                isDisabled={isSaving}
                variant="primary"
                className="bg-[#0070f3] text-white"
                onPress={() => void saveDraft()}
              >
                {isSaving ? "Guardando..." : "Guardar ajustes"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

interface HistoryFieldsProps {
  amount: string;
  disabled?: boolean;
  unit: HistoryWindowUnit;
  onAmountChange: (value: string) => void;
  onUnitChange: (unit: HistoryWindowUnit) => void;
}

function HistoryFields({
  amount,
  disabled = false,
  unit,
  onAmountChange,
  onUnitChange,
}: HistoryFieldsProps) {
  return (
    <div
      className={`grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)] gap-2 ${disabled ? "opacity-50" : ""}`}
    >
      <Input
        aria-label="Cantidad de historial"
        disabled={disabled}
        min="1"
        step="1"
        type="number"
        value={amount}
        onChange={(event) => onAmountChange(event.target.value)}
      />
      <UnitSelect<HistoryWindowUnit>
        disabled={disabled}
        options={[
          ["days", "Días"],
          ["months", "Meses"],
          ["years", "Años"],
        ]}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}

function RefreshFields({
  amount,
  unit,
  onAmountChange,
  onUnitChange,
}: Omit<HistoryFieldsProps, "disabled" | "unit" | "onUnitChange"> & {
  unit: AutoRefreshUnit;
  onUnitChange: (unit: AutoRefreshUnit) => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,0.8fr)] gap-2">
      <Input
        aria-label="Cantidad entre actualizaciones"
        min="1"
        step="1"
        type="number"
        value={amount}
        onChange={(event) => onAmountChange(event.target.value)}
      />
      <UnitSelect<AutoRefreshUnit>
        options={[
          ["minutes", "Minutos"],
          ["hours", "Horas"],
          ["days", "Días"],
        ]}
        value={unit}
        onChange={onUnitChange}
      />
    </div>
  );
}

function UnitSelect<T extends string>({
  disabled = false,
  options,
  value,
  onChange,
}: {
  disabled?: boolean;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Select
      aria-label="Unidad"
      isDisabled={disabled}
      value={value}
      onChange={(nextValue) => nextValue !== null && onChange(nextValue as T)}
    >
      <Select.Trigger className="h-10 w-full">
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([optionValue, label]) => (
            <ListBox.Item id={optionValue} key={optionValue} textValue={label}>
              {label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
