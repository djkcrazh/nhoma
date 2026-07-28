import Link from "next/link";
import { Sparkline } from "./Sparkline";

export function StatCard({
  label,
  value,
  sub,
  href,
  spark,
  sparkColor,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  href?: string;
  spark?: (number | null)[];
  sparkColor?: string;
  accent?: boolean;
}) {
  const body = (
    <div className="card flex h-full flex-col justify-between p-4 transition-transform duration-150 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-2">
        <span className="font-tag text-[10.5px] font-semibold uppercase tracking-widest text-ink-faint">
          {label}
        </span>
        {spark && spark.filter((v) => v != null).length > 1 && (
          <Sparkline data={spark} color={sparkColor ?? "var(--accent)"} width={84} height={26} />
        )}
      </div>
      <div className="mt-2">
        <div className={`font-display text-[26px] font-bold leading-none ${accent ? "text-accent" : ""}`}>
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-ink-faint">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}
