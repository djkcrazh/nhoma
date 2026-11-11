"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ThemeToggle } from "./ThemeToggle";
import { GlobalSearch } from "./GlobalSearch";
import { useQuickAddStore } from "@/stores/quickAdd";
import { useAgentPanel } from "@/stores/agentPanel";
import { Icon } from "@/components/ui/NhomaIcons";

const PAGE_LABELS: Record<string, string> = {
  dashboard: "Overview",
  pigs: "Pigs",
  breeding: "Breeding",
  analytics: "Analytics",
  notifications: "Alerts",
  settings: "Settings",
};

export function Topbar({
  userName,
  role,
  unreadCount,
  farmName,
}: {
  userName: string;
  role: string;
  unreadCount: number;
  farmName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const page = PAGE_LABELS[pathname.split("/")[1] ?? ""];
  const { mode, sheetOpen, toggle } = useAgentPanel();
  const agentShown = mode === "docked" || mode === "maximized" || sheetOpen;
  const openQuickAdd = useQuickAddStore((s) => s.open);
  const searchRef = useRef<HTMLInputElement>(null);
  const [, setTick] = useState(0);

  // Global shortcuts: ⌘K / Ctrl+K focuses search, N opens Quick Add
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const inField = ["INPUT", "TEXTAREA", "SELECT"].includes(
        (e.target as HTMLElement)?.tagName
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (!inField && !e.metaKey && !e.ctrlKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        openQuickAdd();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openQuickAdd]);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-rule bg-ground/85 px-4 py-3 backdrop-blur-md sm:px-6">
      {page && (
        <nav aria-label="Breadcrumb" className="hidden items-center gap-2 text-sm text-ink-faint lg:flex">
          <span className="max-w-40 truncate">{farmName}</span>
          <span aria-hidden>•</span>
          <span className="font-semibold text-ink">{page}</span>
        </nav>
      )}
      <GlobalSearch inputRef={searchRef} />

      <div className="ml-auto flex items-center gap-1.5">
        <ThemeToggle />
        <button
          type="button"
          onClick={toggle}
          aria-pressed={agentShown}
          aria-label={agentShown ? "Hide agent" : "Show agent"}
          title={agentShown ? "Hide agent" : "Show agent"}
          className={`btn btn-ghost btn-sm h-9 w-9 rounded-full p-0 ${agentShown ? "text-accent" : ""}`}
        >
          <Icon.Sparkle className="nhoma-icon" size={17} />
        </button>
        <Link
          href="/notifications"
          className="btn btn-ghost btn-sm relative h-9 w-9 rounded-full p-0"
          aria-label={`Alerts (${unreadCount} unread)`}
        >
          <Icon.Alerts className="nhoma-icon" size={17} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 font-tag text-[9px] font-bold text-accent-ink">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </Link>

        <DropdownMenu.Root onOpenChange={() => setTick((t) => t + 1)}>
          <DropdownMenu.Trigger asChild>
            <button
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft font-display text-sm font-bold text-accent"
              aria-label="Account menu"
            >
              {userName.slice(0, 1).toUpperCase()}
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={8}
              className="card z-50 min-w-48 p-1.5"
              style={{ boxShadow: "var(--shadow-lg)" }}
            >
              <div className="px-3 py-2">
                <div className="text-sm font-semibold">{userName}</div>
                <div className="font-tag text-[10px] uppercase tracking-widest text-ink-faint">
                  {role === "ADMIN" ? "Administrator" : "Farm user"}
                </div>
              </div>
              <DropdownMenu.Separator className="my-1 border-t border-dashed border-rule" />
              {role === "ADMIN" && (
                <DropdownMenu.Item asChild>
                  <button
                    className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-soft outline-none hover:bg-sunken"
                    onClick={() => router.push("/settings")}
                  >
                    Farm settings
                  </button>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item asChild>
                <button
                  className="w-full rounded-md px-3 py-2 text-left text-sm text-ink-soft outline-none hover:bg-sunken"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                >
                  Sign out
                </button>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );
}
