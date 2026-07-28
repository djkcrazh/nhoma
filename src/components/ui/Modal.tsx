"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Icon } from "@/components/ui/NhomaIcons";

export function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content
          className={`card fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100vw-24px)] ${
            wide ? "max-w-3xl" : "max-w-lg"
          } -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6 fade-up`}
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-semibold">{title}</Dialog.Title>
              {subtitle && (
                <Dialog.Description className="mt-0.5 text-sm text-ink-soft">
                  {subtitle}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close className="btn btn-ghost btn-sm -mr-2 -mt-1 px-2" aria-label="Close">
              <Icon.Close className="nhoma-icon" size={15} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-sm text-ink-soft">{message}</p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
