import { redirect } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { db } from "@/server/db";
import { unreadCount } from "@/server/services/notification.service";
import { maybeReconcile } from "@/server/services/notification.service";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { Providers } from "./providers";
import { QuickAddModal } from "@/components/pigs/QuickAddModal";
import { FloatingBadge } from "@/components/brand/FloatingBadge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const farm = await db.farm.findUnique({ where: { id: session.user.farmId } });

  // A stale session can point at a farm that no longer exists (only reachable
  // today via manual DB surgery — there's no farm-deletion feature yet — but
  // cheap to guard). Skip reconcile outright rather than let it hit the
  // Setting_farmId_fkey constraint; the try/catch stays as defense-in-depth
  // for unrelated reconcile failures (e.g. a transient DB error).
  if (farm) {
    try {
      await maybeReconcile(session.user.farmId);
    } catch (err) {
      console.error(`maybeReconcile failed for farm ${session.user.farmId}:`, err);
    }
  }

  const unread = await unreadCount({
    userId: session.user.id,
    farmId: session.user.farmId,
    role: session.user.role,
    userName: session.user.name,
  });

  return (
    <Providers>
      <Sidebar isAdmin={session.user.role === "ADMIN"} farmName={farm?.name ?? "Farm"} />
      <div className="min-[560px]:pl-56 max-[900px]:min-[560px]:pl-16 pb-16 min-[560px]:pb-0">
        <Topbar
          userName={session.user.name}
          role={session.user.role}
          unreadCount={unread}
        />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">{children}</main>
      </div>
      <QuickAddModal />
      <FloatingBadge />
    </Providers>
  );
}
