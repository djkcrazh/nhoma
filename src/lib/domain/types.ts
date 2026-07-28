export type Sex = "MALE" | "FEMALE";

export type PigStatus =
  | "PIGLET"
  | "HEALTHY"
  | "READY_FOR_CROSSING"
  | "PREGNANT"
  | "READY_TO_FARROW"
  | "READY_FOR_MARKET"
  | "SOLD"
  | "INACTIVE"
  | "DEAD";

export type BreedingStatus = "ACTIVE" | "FARROWED" | "FAILED" | "ABORTED";

export type Role = "ADMIN" | "FARM_USER";

export interface FarmSettings {
  marketMinWeightKg: number;
  marketMinAgeDays: number;
  breedingMinAgeDaysFemale: number;
  breedingMinWeightKgFemale: number;
  gestationDays: number;
  pigletMaxAgeDays: number;
  staleWeightDays: number;
  overdueGraceDays: number;
}

export const DEFAULT_SETTINGS: FarmSettings = {
  marketMinWeightKg: 100,
  marketMinAgeDays: 165,
  breedingMinAgeDaysFemale: 240,
  breedingMinWeightKgFemale: 120,
  gestationDays: 114,
  pigletMaxAgeDays: 56,
  staleWeightDays: 30,
  overdueGraceDays: 3,
};

/** Breed options every new farm starts with. Farms may rename, remove, or add
 *  to these freely from Settings — none of them are reserved. */
export const DEFAULT_BREEDS = ["Landrace", "Duroc", "Large White", "Mixed Breed"];

/** Minimal shape of a pig needed by the domain functions. */
export interface DomainPig {
  id: string;
  sex: Sex;
  dateOfBirth: Date;
  status: PigStatus;
  readyForCrossing: boolean;
  breedingStock: boolean;
  castrated: boolean | null;
  soldAt: Date | null;
  diedAt: Date | null;
  currentWeightKg: number | null;
  lastWeighedAt: Date | null;
  motherId: string | null;
  fatherId: string | null;
  activeBreeding: { crossingDate: Date } | null;
}
