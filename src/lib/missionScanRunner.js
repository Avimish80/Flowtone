import { appClient } from "@/api/appClient";
import { scanForActionItems, reconcileActionItems } from "@/lib/actionItemScanner";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getCachedProfileSync, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";

function latestUpdatedAt(records) {
  let max = 0;
  for (const r of records) {
    const t = new Date(r.updated_at || r.created_at || 0).getTime();
    if (t > max) max = t;
  }
  return max;
}

export async function runMissionScan() {
  const [events, documents, clients, existingOpen] = await Promise.all([
    appClient.entities.WorkEvent.list("date"),
    appClient.entities.Document.list("-created_at"),
    appClient.entities.Client.list(),
    appClient.entities.ActionItem.filter({ status: "open" }),
  ]);

  const dataTimestamp = Math.max(
    latestUpdatedAt(events),
    latestUpdatedAt(documents),
    latestUpdatedAt(clients)
  );

  let lastScanData = 0;
  try {
    lastScanData = Number(localStorage.getItem("flowtone_mission_scan_data_at") || 0);
  } catch { /* ignore */ }

  const dataChanged = dataTimestamp > lastScanData || existingOpen.length === 0;

  if (!dataChanged) return;

  const now = Date.now();
  const desired = scanForActionItems(events, documents, clients, now);
  const { toCreate, toResolve } = reconcileActionItems(existingOpen, desired);

  if (toCreate.length === 0 && toResolve.length === 0) {
    try { localStorage.setItem("flowtone_mission_scan_data_at", String(dataTimestamp)); } catch { /* ignore */ }
    return;
  }

  // Resolve items whose underlying issue was fixed
  for (const item of toResolve) {
    await appClient.entities.ActionItem.update(item.id, {
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: "auto",
    }).catch(() => {});
  }

  if (toCreate.length === 0) {
    try { localStorage.setItem("flowtone_mission_scan_data_at", String(dataTimestamp)); } catch { /* ignore */ }
    return;
  }

  // Compose natural language titles via AI (skip in preview mode)
  let titles = {};
  if (!isPreviewModeEnabled()) {
    try {
      const profile = getCachedProfileSync();
      const result = await flowtoneJson("/api/ai/compose-missions", {
        method: "POST",
        body: JSON.stringify({
          items: toCreate,
          name: profile?.user_name || "",
          language: profile?.language || DEFAULT_LANGUAGE,
          assistantName: profile?.assistant_name || "",
        }),
      });
      titles = result.titles || {};
    } catch {
      // AI unavailable — use fallback titles
    }
  }

  for (const item of toCreate) {
    const key = `${item.item_type}::${item.entity_id}`;
    const aiTitle = titles[key];
    const fallbackTitle = buildFallbackTitle(item);

    await appClient.entities.ActionItem.create({
      item_type: item.item_type,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      title: aiTitle || fallbackTitle,
      priority: item.priority,
      status: "open",
      action_type: item.action_type,
      action_target: item.action_target,
      payload: item.payload,
    }).catch(() => {});
  }

  try { localStorage.setItem("flowtone_mission_scan_data_at", String(dataTimestamp)); } catch { /* ignore */ }
}

function buildFallbackTitle(item) {
  const p = item.payload || {};
  switch (item.item_type) {
    case "client_missing_email":
      return `Add an email for ${p.client_name || "this client"}`;
    case "client_missing_phone":
      return `Add a phone number for ${p.client_name || "this client"}`;
    case "gig_missing_location":
      return `Add a location for ${p.event_title || "your gig"}`;
    case "gig_missing_fee":
      return `Set the fee for ${p.event_title || "your gig"}`;
    case "gig_ready_to_invoice":
      return `Invoice ready for ${p.event_title || "your gig"}`;
    case "invoice_overdue":
      return `Overdue invoice for ${p.client_name || "a client"}`;
    case "invoice_draft_stale":
      return `Draft invoice for ${p.client_name || "a client"} is waiting`;
    case "invoice_ready_to_send":
      return `Invoice for ${p.client_name || "a client"} is ready to send`;
    default:
      return "Action needed";
  }
}
