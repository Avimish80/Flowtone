import { appClient } from "@/api/appClient";

export async function getUnreadCount() {
  const all = await appClient.entities.Notification.list("-created_at", 100).catch(() => []);
  return all.filter((n) => !n.read_at).length;
}

export async function refreshAppBadge() {
  if (!("setAppBadge" in navigator)) return;
  const count = await getUnreadCount();
  try {
    if (count > 0) {
      navigator.setAppBadge(count);
    } else {
      navigator.clearAppBadge();
    }
  } catch { /* unsupported on this browser/OS */ }
}

export async function markRead(ids = []) {
  await Promise.allSettled(
    ids.map((id) =>
      appClient.entities.Notification.update(id, { read_at: new Date().toISOString() })
    )
  );
  await refreshAppBadge();
}

export async function markAllRead() {
  const all = await appClient.entities.Notification.list("-created_at", 100).catch(() => []);
  const unread = all.filter((n) => !n.read_at);
  await markRead(unread.map((n) => n.id));
}

export async function notify({ type, title, body = "", entity_type = "", entity_id = "", url = "" }) {
  await appClient.entities.Notification.create({
    type,
    title,
    body,
    entity_type,
    entity_id: entity_id || "",
    url,
  });
  await refreshAppBadge();
}
