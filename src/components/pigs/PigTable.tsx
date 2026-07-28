"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
  VisibilityState,
} from "@tanstack/react-table";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { toast } from "sonner";
import { EnrichedPig } from "@/server/services/pig.service";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EarTag } from "@/components/ui/EarTag";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useQuickAddStore } from "@/stores/quickAdd";
import { bulkStatusAction, deletePigAction, markDeadAction, markSoldAction } from "@/server/actions";
import { RecordWeightModal } from "./RecordWeightModal";
import { RecordCrossingModal } from "@/components/breeding/RecordCrossingModal";
import { ImportCsvModal } from "./ImportCsvModal";
import { Icon } from "@/components/ui/NhomaIcons";

const QUICK_FILTERS = [
  { key: "", label: "All" },
  { key: "male", label: "♂ Male" },
  { key: "female", label: "♀ Female" },
  { key: "piglets", label: "Piglets" },
  { key: "adults", label: "Adults" },
  { key: "pregnant", label: "Pregnant" },
  { key: "crossing", label: "Ready to Cross" },
  { key: "market", label: "Market Ready" },
  { key: "farrow", label: "Ready to Farrow" },
  { key: "castrated", label: "Castrated" },
  { key: "recent", label: "Recently Added" },
  { key: "sold", label: "Sold" },
  { key: "inactive", label: "Inactive" },
];

interface Params {
  search: string;
  quick: string;
  breed: string;
  sort: string;
  closed: boolean;
}

export function PigTable({
  data,
  total,
  page,
  pageCount,
  pageSize,
  breeds,
  isAdmin,
  params,
}: {
  data: EnrichedPig[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  breeds: string[];
  isAdmin: boolean;
  params: Params;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const openQuickAdd = useQuickAddStore((s) => s.open);

  const [search, setSearch] = useState(params.search);
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("pig-table-cols") ?? "{}");
    } catch {
      return {};
    }
  });
  const [weighPig, setWeighPig] = useState<EnrichedPig | null>(null);
  const [crossPig, setCrossPig] = useState<EnrichedPig | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    action: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    localStorage.setItem("pig-table-cols", JSON.stringify(columnVisibility));
  }, [columnVisibility]);

  function setParam(patch: Record<string, string | undefined>) {
    const sp = new URLSearchParams();
    const merged = {
      search: params.search,
      quick: params.quick,
      breed: params.breed,
      sort: params.sort,
      closed: params.closed ? "1" : "",
      ...patch,
    };
    for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
    router.push(`${pathname}?${sp.toString()}`);
  }

  function onSearchChange(v: string) {
    setSearch(v);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setParam({ search: v || undefined, page: undefined }), 350);
  }

  function toggleSort(field: string) {
    const [f, d] = params.sort.split(":");
    const next = f === field && d === "asc" ? "desc" : "asc";
    setParam({ sort: `${field}:${next}` });
  }

  function sortIndicator(field: string) {
    const [f, d] = params.sort.split(":");
    if (f !== field) return <span className="opacity-30"> ↕</span>;
    return <span className="text-accent">{d === "asc" ? " ↑" : " ↓"}</span>;
  }

  const columns = useMemo<ColumnDef<EnrichedPig>[]>(
    () => [
      {
        id: "select",
        enableHiding: false,
        header: ({ table }) => (
          <input
            type="checkbox"
            className="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            className="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label={`Select ${row.original.tagId}`}
          />
        ),
      },
      {
        id: "tagId",
        header: () => <button className="-my-1 py-1" onClick={() => toggleSort("tagId")}>Pig ID{sortIndicator("tagId")}</button>,
        cell: ({ row }) => <EarTag tagId={row.original.tagId} />,
        enableHiding: false,
      },
      {
        id: "breed",
        header: () => <button className="-my-1 py-1" onClick={() => toggleSort("breed")}>Breed{sortIndicator("breed")}</button>,
        cell: ({ row }) => <span className="text-ink-soft">{row.original.breed}</span>,
      },
      {
        id: "sex",
        header: "Sex",
        cell: ({ row }) => (
          <span className={row.original.sex === "FEMALE" ? "text-accent" : "text-breeding"}>
            {row.original.sex === "FEMALE" ? "♀" : "♂"}
          </span>
        ),
      },
      {
        id: "age",
        header: () => <button className="-my-1 py-1" onClick={() => toggleSort("age")}>Age{sortIndicator("age")}</button>,
        cell: ({ row }) => <span className="font-tag text-xs">{row.original.ageLabel}</span>,
      },
      {
        id: "weight",
        header: "Weight",
        cell: ({ row }) =>
          row.original.weightKg != null ? (
            <span className="font-tag text-xs font-semibold">{row.original.weightKg} kg</span>
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      {
        id: "mother",
        header: "Mother",
        cell: ({ row }) =>
          row.original.mother ? (
            <EarTag tagId={row.original.mother.tagId} neutral removed={row.original.mother.removed} />
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      {
        id: "father",
        header: "Father",
        cell: ({ row }) =>
          row.original.father ? (
            <EarTag tagId={row.original.father.tagId} neutral removed={row.original.father.removed} />
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      {
        id: "crossing",
        header: "Cross-Ready",
        cell: ({ row }) =>
          row.original.status === "READY_FOR_CROSSING" ? (
            <Icon.Check className="text-ok" size={14} />
          ) : (
            <span className="text-ink-faint">—</span>
          ),
      },
      {
        id: "pregnancy",
        header: "Pregnancy",
        cell: ({ row }) => {
          const g = row.original.gestation;
          if (!g) return <span className="text-ink-faint">—</span>;
          if (g.isOverdue)
            return (
              <span className="status-badge status-badge--overdue">
                <span className="dot" />+{g.overdueDays}d overdue
              </span>
            );
          return (
            <span className="font-tag text-xs text-breeding">
              day {g.daysPregnant}/{114}
            </span>
          );
        },
      },
      {
        id: "daysRemaining",
        header: "Days Left",
        cell: ({ row }) => {
          const g = row.original.gestation;
          if (!g) return <span className="text-ink-faint">—</span>;
          return (
            <span className={`font-tag text-xs font-semibold ${g.daysRemaining <= 7 ? "text-due" : ""}`}>
              {g.daysRemaining}d
            </span>
          );
        },
      },
      {
        id: "market",
        header: "Market",
        cell: ({ row }) =>
          row.original.marketReady ? <Icon.Check className="text-ok" size={14} /> : <span className="text-ink-faint">—</span>,
      },
      {
        id: "castrated",
        header: "Castrated",
        cell: ({ row }) =>
          row.original.sex === "MALE" ? (
            row.original.castrated ? (
              <Icon.Check className="text-ink-soft" size={14} />
            ) : (
              <span className="text-ink-faint">no</span>
            )
          ) : (
            <span className="text-ink-faint">n/a</span>
          ),
      },
      {
        id: "status",
        header: () => <button className="-my-1 py-1" onClick={() => toggleSort("status")}>Status{sortIndicator("status")}</button>,
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
        enableHiding: false,
      },
      {
        id: "actions",
        enableHiding: false,
        header: "",
        cell: ({ row }) => <RowActions pig={row.original} />,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params.sort, isAdmin]
  );

  function RowActions({ pig }: { pig: EnrichedPig }) {
    return (
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="btn btn-ghost btn-sm h-8 w-8 p-0" aria-label={`Actions for ${pig.tagId}`}>
            <Icon.Menu className="nhoma-icon" size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="card z-50 min-w-44 p-1.5" style={{ boxShadow: "var(--shadow-lg)" }}>
            <Item onSelect={() => router.push(`/pigs/${pig.tagId}`)}>View profile</Item>
            <Item onSelect={() => setWeighPig(pig)}>Record weight</Item>
            {pig.sex === "FEMALE" && !pig.gestation && pig.status !== "SOLD" && pig.status !== "DEAD" && (
              <Item onSelect={() => setCrossPig(pig)}>Record crossing</Item>
            )}
            <DropdownMenu.Separator className="my-1 border-t border-dashed border-rule" />
            {pig.status !== "SOLD" && pig.status !== "DEAD" && (
              <>
                <Item
                  onSelect={() =>
                    setConfirm({
                      title: `Mark ${pig.tagId} as sold?`,
                      message: pig.gestation
                        ? "This sow has an active pregnancy — it will be closed as failed."
                        : "The pig will move to the sold ledger and stop appearing in active lists.",
                      action: async () => {
                        const r = await markSoldAction(pig.id);
                        if (r.ok) toast.success(`${pig.tagId} marked sold`);
                        else toast.error(r.error);
                        router.refresh();
                      },
                    })
                  }
                >
                  Mark sold
                </Item>
                <Item
                  onSelect={() =>
                    setConfirm({
                      title: `Mark ${pig.tagId} as dead?`,
                      message: pig.gestation
                        ? "This sow has an active pregnancy — it will be closed as failed."
                        : "This records a death on the ledger. It cannot be undone from the UI.",
                      danger: true,
                      action: async () => {
                        const r = await markDeadAction(pig.id);
                        if (r.ok) toast.success(`${pig.tagId} marked dead`);
                        else toast.error(r.error);
                        router.refresh();
                      },
                    })
                  }
                >
                  Mark dead
                </Item>
              </>
            )}
            {isAdmin && (
              <Item
                danger
                onSelect={() =>
                  setConfirm({
                    title: `Remove ${pig.tagId} from the ledger?`,
                    message:
                      "The pig is soft-deleted: lineage of its offspring is preserved, but it disappears from all lists.",
                    danger: true,
                    action: async () => {
                      const r = await deletePigAction(pig.id);
                      if (r.ok) toast.success(`${pig.tagId} removed`);
                      else toast.error(r.error);
                      router.refresh();
                    },
                  })
                }
              >
                Delete
              </Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    );
  }

  const table = useReactTable({
    data,
    columns,
    state: { rowSelection, columnVisibility },
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });

  const selectedIds = Object.keys(rowSelection);

  async function bulk(action: "SOLD" | "INACTIVE" | "DELETE") {
    const label = action === "SOLD" ? "mark sold" : action === "DELETE" ? "delete" : "mark inactive";
    setConfirm({
      title: `${label[0].toUpperCase() + label.slice(1)} ${selectedIds.length} pigs?`,
      message: `This will ${label} every selected pig. Pregnant sows will have their breeding closed.`,
      danger: action === "DELETE",
      action: async () => {
        const r = await bulkStatusAction(selectedIds, action);
        if (r.ok) {
          toast.success(`${r.data.ok} updated${r.data.failed ? `, ${r.data.failed} failed` : ""}`);
          setRowSelection({});
        } else toast.error(r.error);
        router.refresh();
      },
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Pigs</h1>
          <p className="text-sm text-ink-soft">{total} on the ledger</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
            Import CSV
          </button>
          <a className="btn btn-secondary btn-sm" href="/api/pigs/export" download>
            Export CSV
          </a>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="btn btn-secondary btn-sm">
                Columns <Icon.ChevronDown size={13} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={4} className="card z-50 min-w-44 p-1.5" style={{ boxShadow: "var(--shadow-lg)" }}>
                {table
                  .getAllColumns()
                  .filter((c) => c.getCanHide())
                  .map((col) => (
                    <label key={col.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-1.5 text-sm hover:bg-sunken">
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={col.getIsVisible()}
                        onChange={(e) => col.toggleVisibility(e.target.checked)}
                      />
                      <span className="capitalize">{col.id.replace(/([A-Z])/g, " $1")}</span>
                    </label>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <button className="btn btn-primary btn-sm" onClick={() => openQuickAdd()}>
            <Icon.Plus size={14} /> Add Pig
          </button>
        </div>
      </div>

      {/* Search + filters */}
      <div className="card space-y-3 p-3.5">
        <div className="flex flex-wrap gap-2.5">
          <div className="relative min-w-52 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint">
              <Icon.Search size={16} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: "2.5rem" }}
              placeholder="Search tag, breed, parent, note…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <select
            className="select w-44"
            value={params.breed}
            onChange={(e) => setParam({ breed: e.target.value || undefined, page: undefined })}
            aria-label="Filter by breed"
          >
            <option value="">All breeds</option>
            {breeds.map((b) => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-ink-soft">
            <input
              type="checkbox"
              className="checkbox"
              checked={params.closed}
              onChange={(e) => setParam({ closed: e.target.checked ? "1" : undefined, page: undefined })}
            />
            Include sold / inactive
          </label>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FILTERS.map((f) => (
            <button
              key={f.key}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                params.quick === f.key
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-rule-strong text-ink-soft hover:border-ink-faint hover:text-ink"
              }`}
              onClick={() => setParam({ quick: f.key || undefined, page: undefined })}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk bar */}
      {selectedIds.length > 0 && (
        <div className="card flex flex-wrap items-center gap-3 border-accent bg-accent-soft px-4 py-2.5 fade-up">
          <span className="text-sm font-semibold text-accent">{selectedIds.length} selected</span>
          <div className="ml-auto flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => bulk("SOLD")}>Mark sold</button>
            <button className="btn btn-secondary btn-sm" onClick={() => bulk("INACTIVE")}>Mark inactive</button>
            {isAdmin && (
              <button className="btn btn-danger btn-sm" onClick={() => bulk("DELETE")}>Delete</button>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setRowSelection({})}>Clear</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-x-auto">
        <table className="data-table min-w-[900px]">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id}>{h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}</th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleFlatColumns().length} className="py-14 text-center">
                  <p className="text-ink-faint">No pigs match this view.</p>
                  <button className="btn btn-primary btn-sm mt-3" onClick={() => openQuickAdd()}>
                    <Icon.Plus size={14} /> Add your first pig
                  </button>
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={row.getIsSelected() ? "bg-accent-soft" : ""}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-soft">
        <span className="font-tag text-xs">
          page {page} of {Math.max(pageCount, 1)} · {total} pigs
        </span>
        <div className="flex items-center gap-2">
          <select
            className="select w-28"
            value={pageSize}
            onChange={(e) => setParam({ pageSize: e.target.value, page: undefined })}
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / page</option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setParam({ page: String(page - 1) })}>
            ← Prev
          </button>
          <button className="btn btn-secondary btn-sm" disabled={page >= pageCount} onClick={() => setParam({ page: String(page + 1) })}>
            Next →
          </button>
        </div>
      </div>

      {/* Modals */}
      {weighPig && (
        <RecordWeightModal pig={weighPig} open onOpenChange={(o) => !o && setWeighPig(null)} />
      )}
      {crossPig && (
        <RecordCrossingModal
          open
          onOpenChange={(o) => !o && setCrossPig(null)}
          presetSow={{ id: crossPig.id, tagId: crossPig.tagId }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={confirm.title}
          message={confirm.message}
          danger={confirm.danger}
          busy={confirmBusy}
          confirmLabel="Yes, continue"
          onConfirm={async () => {
            setConfirmBusy(true);
            await confirm.action();
            setConfirmBusy(false);
            setConfirm(null);
          }}
        />
      )}
      <ImportCsvModal open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}

function Item({
  children,
  onSelect,
  danger,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  danger?: boolean;
}) {
  return (
    <DropdownMenu.Item asChild>
      <button
        className={`w-full rounded-md px-3 py-1.5 text-left text-sm outline-none hover:bg-sunken ${
          danger ? "text-overdue" : "text-ink-soft"
        }`}
        onClick={onSelect}
      >
        {children}
      </button>
    </DropdownMenu.Item>
  );
}
