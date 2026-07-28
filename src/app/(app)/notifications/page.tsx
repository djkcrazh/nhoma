import { requireCtx } from "@/server/auth/auth";
import { listNotifications } from "@/server/services/notification.service";
import { NotificationList } from "@/components/notifications/NotificationList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const notifications = await listNotifications(ctx, { limit: 100 });
  return (
    <div className="fade-up">
      <NotificationList notifications={notifications} />
    </div>
  );
}
