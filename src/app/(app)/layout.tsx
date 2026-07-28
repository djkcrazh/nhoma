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

  await maybeReconcile(session.user.farmId);

  const [farm, unread] = await Promise.all([
    db.farm.findUnique({ where: { id: session.user.farmId } }),
    unreadCount({
      userId: session.user.id,
      farmId: session.user.farmId,
      role: session.user.role,
      userName: session.user.name,
    }),
  ]);

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
