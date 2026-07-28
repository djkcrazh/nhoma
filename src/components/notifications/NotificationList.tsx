"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EarTag } from "@/components/ui/EarTag";
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/server/actions";
import { Icon } from "@/components/ui/NhomaIcons";

interface Item {
  id: string;
  type: string;
  severity: string;
  message: string;
  pigTag: string | null;
  readAt: string | null;
  createdAt: string;
}

const FILTERS = [
  { key: "", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warning", label: "Warnings" },
  { key: "success", label: "Opportunities" },
  { key: "info", label: "Info" },
];

function relTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function NotificationList({ notifications }: { notifications: Item[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const items = filter ? notifications.filter((n) => n.severity === filter) : notifications;
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Alerts</h1>
          <p className="mt-0.5 text-sm text-ink-soft">
            {notifications.length} open · {unread} unread
          </p>
        </div>
        {unread > 0 && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              await markAllNotificationsReadAction();
              router.refresh();
            }}
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
              filter === f.key
                ? "border-accent bg-accent-soft text-accent"
                : "border-rule-strong text-ink-soft hover:text-ink"
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="card px-6 py-14 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center text-ok">
            <Icon.Check size={26} />
          </div>
          <p className="mt-2 font-display font-semibold">All clear</p>
          <p className="mt-1 text-sm text-ink-faint">Nothing needs your attention in this view.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li
              key={n.id}
              className={`alert-stripe alert-stripe--${n.severity} card flex items-center gap-3 px-4 py-3 ${
                n.readAt ? "opacity-70" : ""
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">{n.message}</p>
                <p className="mt-0.5 font-tag text-[10px] uppercase tracking-wider text-ink-faint">
                  {n.type.replaceAll("_", " ").toLowerCase()} · {relTime(n.createdAt)}
                  {!n.readAt && <span className="ml-2 font-bold text-accent">● new</span>}
                </p>
              </div>
              {n.pigTag && <EarTag tagId={n.pigTag} />}
              <div className="flex gap-1">
                {!n.readAt && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await markNotificationReadAction(n.id);
                      router.refresh();
                    }}
                  >
                    Read
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm text-ink-faint"
                  title="Dismiss"
                  onClick={async () => {
                    const r = await dismissNotificationAction(n.id);
                    if (r.ok) toast.success("Dismissed");
                    router.refresh();
                  }}
                >
                  <Icon.Close size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
