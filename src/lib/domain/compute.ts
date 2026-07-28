import { DomainPig, FarmSettings, PigStatus } from "./types";

const DAY_MS = 86_400_000;

export function ageDays(dob: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - dob.getTime()) / DAY_MS));
}

/** Human age label: "3w", "7mo 2w", "2y 3mo". */
export function ageLabel(dob: Date, now: Date = new Date()): string {
  const days = ageDays(dob, now);
  if (days < 7) return `${days}d`;
  if (days < 60) {
    const w = Math.floor(days / 7);
    const d = days % 7;
    return d > 0 ? `${w}w ${d}d` : `${w}w`;
  }
  if (days < 365) {
    const mo = Math.floor(days / 30.44);
    const w = Math.floor((days - mo * 30.44) / 7);
    return w > 0 ? `${mo}mo ${w}w` : `${mo}mo`;
  }
  const y = Math.floor(days / 365.25);
  const mo = Math.floor((days - y * 365.25) / 30.44);
  return mo > 0 ? `${y}y ${mo}mo` : `${y}y`;
}

export interface Gestation {
  daysPregnant: number;
  daysRemaining: number;
  expectedFarrowingDate: Date;
  isOverdue: boolean;
  overdueDays: number;
}

export function gestation(
  crossingDate: Date,
  settings: FarmSettings,
  now: Date = new Date()
): Gestation {
  const elapsed = Math.max(
    0,
    Math.floor((now.getTime() - crossingDate.getTime()) / DAY_MS)
  );
  const daysPregnant = Math.min(elapsed, settings.gestationDays);
  const daysRemaining = Math.max(settings.gestationDays - elapsed, 0);
  const expectedFarrowingDate = new Date(
    crossingDate.getTime() + settings.gestationDays * DAY_MS
  );
  const overdueDays = Math.max(0, elapsed - settings.gestationDays);
  return {
    daysPregnant,
    daysRemaining,
    expectedFarrowingDate,
    isOverdue: overdueDays > settings.overdueGraceDays,
    overdueDays,
  };
}

export function isPiglet(pig: DomainPig, s: FarmSettings, now = new Date()) {
  return ageDays(pig.dateOfBirth, now) < s.pigletMaxAgeDays;
}

export function isMarketReady(pig: DomainPig, s: FarmSettings, now = new Date()) {
  return (
    pig.currentWeightKg !== null &&
    pig.currentWeightKg >= s.marketMinWeightKg &&
    ageDays(pig.dateOfBirth, now) >= s.marketMinAgeDays
  );
}

export function isBreedingEligible(pig: DomainPig, s: FarmSettings, now = new Date()) {
  if (pig.sex !== "FEMALE") return false;
  if (pig.soldAt || pig.diedAt) return false;
  if (pig.activeBreeding) return false;
  return (
    ageDays(pig.dateOfBirth, now) >= s.breedingMinAgeDaysFemale &&
    pig.currentWeightKg !== null &&
    pig.currentWeightKg >= s.breedingMinWeightKgFemale
  );
}

/**
 * Single source of truth for a pig's materialized status.
 * Precedence: terminal manual states, then breeding states, then market,
 * then crossing eligibility, then age class.
 */
export function resolveStatus(
  pig: DomainPig,
  s: FarmSettings,
  now: Date = new Date()
): PigStatus {
  if (pig.diedAt) return "DEAD";
  if (pig.soldAt) return "SOLD";
  if (pig.status === "INACTIVE") return "INACTIVE";

  if (pig.activeBreeding) {
    const g = gestation(pig.activeBreeding.crossingDate, s, now);
    return g.daysRemaining === 0 ? "READY_TO_FARROW" : "PREGNANT";
  }

  if (isMarketReady(pig, s, now) && !pig.breedingStock) return "READY_FOR_MARKET";
  if (pig.readyForCrossing || isBreedingEligible(pig, s, now))
    return "READY_FOR_CROSSING";
  if (isPiglet(pig, s, now)) return "PIGLET";
  return "HEALTHY";
}

export type WarningType =
  | "OVERDUE_PREGNANCY"
  | "PREGNANCY_ENDING_SOON"
  | "MISSING_PARENTS"
  | "STALE_WEIGHT"
  | "MARKET_READY"
  | "BREEDING_READY"
  | "WEIGHT_DROP";

export interface PigWarning {
  type: WarningType;
  severity: "info" | "warning" | "critical" | "success";
  message: string;
}

export function computeWarnings(
  pig: DomainPig,
  s: FarmSettings,
  now: Date = new Date()
): PigWarning[] {
  const warnings: PigWarning[] = [];
  if (pig.diedAt || pig.soldAt || pig.status === "INACTIVE") return warnings;

  if (pig.activeBreeding) {
    const g = gestation(pig.activeBreeding.crossingDate, s, now);
    if (g.isOverdue) {
      warnings.push({
        type: "OVERDUE_PREGNANCY",
        severity: "critical",
        message: `Pregnancy overdue by ${g.overdueDays} day${g.overdueDays === 1 ? "" : "s"}`,
      });
    } else if (g.daysRemaining <= 7) {
      warnings.push({
        type: "PREGNANCY_ENDING_SOON",
        severity: "warning",
        message: `Farrowing due in ${g.daysRemaining} day${g.daysRemaining === 1 ? "" : "s"}`,
      });
    }
  }

  if (!pig.motherId && !pig.fatherId && !isPigletExempt(pig, s, now)) {
    warnings.push({
      type: "MISSING_PARENTS",
      severity: "info",
      message: "No parents recorded",
    });
  }

  if (
    pig.lastWeighedAt &&
    ageDays(pig.lastWeighedAt, now) > s.staleWeightDays
  ) {
    warnings.push({
      type: "STALE_WEIGHT",
      severity: "warning",
      message: `No weight update in ${ageDays(pig.lastWeighedAt, now)} days`,
    });
  } else if (!pig.lastWeighedAt) {
    warnings.push({
      type: "STALE_WEIGHT",
      severity: "warning",
      message: "Never weighed",
    });
  }

  if (isMarketReady(pig, s, now) && !pig.breedingStock) {
    warnings.push({
      type: "MARKET_READY",
      severity: "success",
      message: "Meets market weight and age thresholds",
    });
  }

  if (!pig.activeBreeding && isBreedingEligible(pig, s, now)) {
    warnings.push({
      type: "BREEDING_READY",
      severity: "info",
      message: "Eligible for crossing",
    });
  }

  return warnings;
}

// Purchased adult stock legitimately lacks parents; only nag for farm-born ages.
function isPigletExempt(pig: DomainPig, s: FarmSettings, now: Date) {
  return ageDays(pig.dateOfBirth, now) > 365 * 2;
}
