import { Role } from "@/lib/domain/types";

export type Action =
  | "pig:create"
  | "pig:update"
  | "pig:delete"
  | "pig:view"
  | "weight:create"
  | "breeding:create"
  | "breeding:update"
  | "note:create"
  | "analytics:view"
  | "user:manage"
  | "settings:manage"
  | "data:import"
  | "data:export";

const PERMISSIONS: Record<Action, Role[]> = {
  "pig:create": ["ADMIN", "FARM_USER"],
  "pig:update": ["ADMIN", "FARM_USER"],
  "pig:delete": ["ADMIN"],
  "pig:view": ["ADMIN", "FARM_USER"],
  "weight:create": ["ADMIN", "FARM_USER"],
  "breeding:create": ["ADMIN", "FARM_USER"],
  "breeding:update": ["ADMIN", "FARM_USER"],
  "note:create": ["ADMIN", "FARM_USER"],
  "analytics:view": ["ADMIN", "FARM_USER"],
  "user:manage": ["ADMIN"],
  "settings:manage": ["ADMIN"],
  "data:import": ["ADMIN", "FARM_USER"],
  "data:export": ["ADMIN", "FARM_USER"],
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[action]?.includes(role) ?? false;
}

export class PermissionError extends Error {
  constructor(action: Action) {
    super(`Not permitted: ${action}`);
    this.name = "PermissionError";
  }
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new PermissionError(action);
}
