"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuickAddStore } from "@/stores/quickAdd";
import { useAgentPanel, useIsDesktop } from "@/stores/agentPanel";
import { BrandMark } from "@/components/brand/BrandMark";
import { Icon } from "@/components/ui/NhomaIcons";

interface NavItem {
  href: string;
  label: string;
  icon: (typeof Icon)[keyof typeof Icon];
  /** Key into the counts prop; shown as a quiet number beside the label. */
  count?: "pigs" | "pregnant";
  /** Alerts use the unread count and a brand-colored badge. */
  unread?: boolean;
}

const OVERVIEW: NavItem = { href: "/dashboard", label: "Overview", icon: Icon.Overview };

const GROUPS: { label: string; items: NavItem[]; adminOnly?: boolean }[] = [
  {
    label: "Herd",
    items: [
      { href: "/pigs", label: "Pigs", icon: Icon.Pigs, count: "pigs" },
      { href: "/breeding", label: "Breeding", icon: Icon.Breeding, count: "pregnant" },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/analytics", label: "Analytics", icon: Icon.Analytics },
      { href: "/notifications", label: "Alerts", icon: Icon.Alerts, unread: true },
    ],
  },
  {
    label: "Farm",
    adminOnly: true,
    items: [{ href: "/settings", label: "Settings", icon: Icon.Settings }],
  },
];

export interface SidebarCounts {
  pigs: number;
  pregnant: number;
  unread: number;
}

export function Sidebar({
  isAdmin,
  farmName,
  counts,
}: {
  isAdmin: boolean;
  farmName: string;
  counts: SidebarCounts;
}) {
  const pathname = usePathname();
  const openQuickAdd = useQuickAddStore((s) => s.open);
  const { mode, sheetFull, openFull, leaveFull } = useAgentPanel();
  const isDesktop = useIsDesktop();
  // Full-screen agent: the maximized panel on desktop, the "full" sheet below.
  const agentActive = isDesktop ? mode === "maximized" : sheetFull;

  const groups = GROUPS.filter((g) => !g.adminOnly || isAdmin);
  // The phone bottom bar has room for four destinations plus Add.
  const mobileItems = [OVERVIEW, ...groups.flatMap((g) => g.items)].slice(0, 4);

  function renderAgentItem() {
    return (
      <button
        type="button"
        title="Agent"
        aria-pressed={agentActive}
        onClick={() => (agentActive ? leaveFull() : openFull())}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors max-[900px]:justify-center max-[900px]:px-0 ${
          agentActive ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-sunken hover:text-ink"
        }`}
      >
        <span className="flex w-5 items-center justify-center" aria-hidden>
          <Icon.Sparkle className="nhoma-icon" size={17} />
        </span>
        <span className="max-[900px]:hidden">Agent</span>
        <span className="ml-auto rounded-[5px] bg-accent-soft px-1.5 py-px font-tag text-[9px] font-semibold uppercase tracking-[0.1em] text-accent max-[900px]:hidden">
          Beta
        </span>
      </button>
    );
  }

  function renderLink(item: NavItem) {
    const active = pathname.startsWith(item.href);
    const ItemIcon = item.icon;
    const n = item.unread ? counts.unread : item.count ? counts[item.count] : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        title={item.label}
        aria-current={active && !agentActive ? "page" : undefined}
        onClick={leaveFull}
        className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors max-[900px]:justify-center max-[900px]:px-0 ${
          active && !agentActive ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-sunken hover:text-ink"
        }`}
      >
        <span className="flex w-5 items-center justify-center" aria-hidden>
          <ItemIcon className="nhoma-icon" size={17} />
        </span>
        <span className="max-[900px]:hidden">{item.label}</span>
        {n > 0 &&
          (item.unread ? (
            <span className="ml-auto min-w-[18px] rounded-full bg-accent px-1.5 text-center font-tag text-[10px] font-bold leading-[18px] text-accent-ink max-[900px]:hidden">
              {n > 99 ? "99+" : n}
            </span>
          ) : (
            <span className="ml-auto font-tag text-[11px] text-ink-faint max-[900px]:hidden">{n}</span>
          ))}
      </Link>
    );
  }

  return (
    <>
      {/* Desktop / tablet sidebar — collapses to an icon rail below 900px */}
      <aside className="app-sidebar fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-rule max-[900px]:w-16 min-[560px]:flex">
        <div className="flex items-center gap-2.5 px-4 py-[18px] max-[900px]:justify-center max-[900px]:px-0">
          <BrandMark size={36} />
          <div className="min-w-0 max-[900px]:hidden">
            <div className="truncate font-display text-[15px] font-bold leading-tight">{farmName}</div>
            <div
              className="font-tenor text-[10px] uppercase text-ink-faint"
              style={{ fontFamily: "var(--font-tenor), 'Tenor Sans', serif", letterSpacing: "0.32em" }}
            >
              Nhoma
            </div>
          </div>
        </div>

        <div className="px-3 pb-3 max-[900px]:px-2">
          <button
            onClick={() => openQuickAdd()}
            className="btn btn-primary w-full max-[900px]:h-11 max-[900px]:min-h-0 max-[900px]:px-0"
            title="Add pig (N)"
          >
            <Icon.Plus className="nhoma-icon" size={16} />
            <span className="max-[900px]:hidden">Add Pig</span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 max-[900px]:px-2" aria-label="Main">
          <div className="space-y-0.5 pt-1">
            {renderLink(OVERVIEW)}
            {renderAgentItem()}
          </div>
          {groups.map((g) => (
            <div key={g.label} className="space-y-0.5 pt-4">
              <div className="px-3 pb-1 font-tag text-[10px] uppercase tracking-[0.16em] text-ink-faint max-[900px]:hidden">
                {g.label}
              </div>
              {g.items.map(renderLink)}
            </div>
          ))}
        </nav>

        <div className="border-t border-dashed border-rule px-5 py-3 font-tag text-[10px] uppercase tracking-widest text-ink-faint max-[900px]:hidden">
          Nhoma v2
        </div>
      </aside>

      {/* Mobile bottom nav below 560px */}
      <nav
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t border-rule bg-raised pb-[env(safe-area-inset-bottom)] min-[560px]:hidden"
        aria-label="Main"
      >
        {mobileItems.map((item) => {
          const active = pathname.startsWith(item.href);
          const ItemIcon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              onClick={leaveFull}
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
