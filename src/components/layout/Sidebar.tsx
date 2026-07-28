"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuickAddStore } from "@/stores/quickAdd";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon } from "@/components/ui/NhomaIcons";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Icon.Overview },
  { href: "/pigs", label: "Pigs", icon: Icon.Pigs },
  { href: "/breeding", label: "Breeding", icon: Icon.Breeding },
  { href: "/analytics", label: "Analytics", icon: Icon.Analytics },
  { href: "/notifications", label: "Alerts", icon: Icon.Alerts },
];

const ADMIN_NAV = [{ href: "/settings", label: "Settings", icon: Icon.Settings }];

export function Sidebar({ isAdmin, farmName }: { isAdmin: boolean; farmName: string }) {
  const pathname = usePathname();
  const openQuickAdd = useQuickAddStore((s) => s.open);
  const items = isAdmin ? [...NAV, ...ADMIN_NAV] : NAV;

  return (
    <>
      {/* Desktop / tablet sidebar — collapses to icon rail below 900px */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-56 flex-col border-r border-rule bg-raised max-[900px]:w-16 min-[560px]:flex">
        <div className="flex items-center gap-2.5 px-5 py-5 max-[900px]:justify-center max-[900px]:px-0">
          <BrandMark size={38} />
          <div className="max-[900px]:hidden">
            <div className="font-display text-[15px] font-bold leading-tight">{farmName}</div>
            <div
              className="font-tenor text-[10px] uppercase text-ink-faint"
              style={{ fontFamily: "var(--font-tenor), 'Tenor Sans', serif", letterSpacing: "0.32em" }}
            >
              Nhoma
            </div>
          </div>
        </div>

        <div className="px-3 pb-4 max-[900px]:px-2">
          <button
            onClick={() => openQuickAdd()}
            className="btn btn-primary w-full max-[900px]:h-11 max-[900px]:min-h-0 max-[900px]:px-0"
            title="Add pig (N)"
          >
            <Icon.Plus className="nhoma-icon" size={16} />
            <span className="max-[900px]:hidden">Add Pig</span>
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 max-[900px]:px-2">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            const ItemIcon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors max-[900px]:justify-center max-[900px]:px-0 ${
                  active
                    ? "bg-accent-soft text-accent"
                    : "text-ink-soft hover:bg-sunken hover:text-ink"
                }`}
              >
                <span className="flex w-5 items-center justify-center" aria-hidden>
                  <ItemIcon className="nhoma-icon" size={17} />
                </span>
                <span className="max-[900px]:hidden">{item.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent max-[900px]:hidden" />}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-dashed border-rule px-5 py-3 font-tag text-[10px] uppercase tracking-widest text-ink-faint max-[900px]:hidden">
          Nhoma v1
        </div>
      </aside>

      {/* Mobile bottom nav below 560px */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-rule bg-raised pb-[env(safe-area-inset-bottom)] min-[560px]:hidden">
        {items.slice(0, 4).map((item) => {
          const active = pathname.startsWith(item.href);
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold ${
                active ? "text-accent" : "text-ink-faint"
              }`}
            >
              <ItemIcon className="nhoma-icon" size={19} />
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => openQuickAdd()}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold text-accent"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-ink">
            <Icon.Plus size={13} />
          </span>
          Add
        </button>
      </nav>
    </>
  );
}
