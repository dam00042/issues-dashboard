export const EXPECTED_API_CONTRACT_VERSION = 1;

export type BackendHealth = {
  apiVersion: string;
  contractVersion: number;
  schemaVersion: number;
  status: "ok";
};

export class BackendContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendContractError";
  }
}

export function assertCompatibleBackendHealth(payload: unknown): BackendHealth {
  if (!payload || typeof payload !== "object") {
    throw new Error("La API local ha devuelto un estado no válido.");
  }

  const health = payload as Partial<BackendHealth>;
  if (health.status !== "ok" || typeof health.apiVersion !== "string") {
    throw new Error("La API local todavía no está preparada.");
  }
  if (health.contractVersion !== EXPECTED_API_CONTRACT_VERSION) {
    throw new BackendContractError(
      `La interfaz incluye el contrato ${String(EXPECTED_API_CONTRACT_VERSION)}, pero la API local expone el contrato ${String(health.contractVersion ?? "desconocido")}. Reinstala la aplicación para recuperar un paquete coherente.`,
    );
  }
  if (
    typeof health.schemaVersion !== "number" ||
    !Number.isInteger(health.schemaVersion) ||
    health.schemaVersion < 1
  ) {
    throw new BackendContractError(
      "La API local no ha inicializado correctamente la base de datos.",
    );
  }

  return health as BackendHealth;
}
