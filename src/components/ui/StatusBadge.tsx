import { PigStatus } from "@/lib/domain/types";

const CONFIG: Record<PigStatus, { label: string; variant: string }> = {
  HEALTHY: { label: "Healthy", variant: "ok" },
  PIGLET: { label: "Piglet", variant: "accent" },
  READY_FOR_CROSSING: { label: "Ready for Crossing", variant: "breeding" },
  PREGNANT: { label: "Pregnant", variant: "breeding" },
  READY_TO_FARROW: { label: "Ready to Farrow", variant: "due" },
  READY_FOR_MARKET: { label: "Market Ready", variant: "ok" },
  SOLD: { label: "Sold", variant: "neutral" },
  INACTIVE: { label: "Inactive", variant: "neutral" },
  DEAD: { label: "Dead", variant: "overdue" },
};

export function StatusBadge({ status }: { status: PigStatus | string }) {
  const c = CONFIG[status as PigStatus] ?? { label: status, variant: "neutral" };
  return (
    <span className={`status-badge status-badge--${c.variant}`}>
      <span className="dot" aria-hidden />
      {c.label}
    </span>
  );
}

export function statusLabel(status: string): string {
  return CONFIG[status as PigStatus]?.label ?? status;
}
