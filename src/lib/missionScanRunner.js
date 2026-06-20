import { appClient } from "@/api/appClient";
import { scanForActionItems, reconcileActionItems, extractCandidateFindings } from "@/lib/actionItemScanner";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getCachedProfileSync, getAssistantProfile, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";

function latestUpdatedAt(records) {
  let max = 0;
  for (const r of records) {
    const t = new Date(r.updated_at || r.created_at || 0).getTime();
    if (t > max) max = t;
  }
  return max;
}

export async function runMissionScan() {
  const [events, documents, clients, allItems] = await Promise.all([
    appClient.entities.WorkEvent.list("date"),
    appClient.entities.Document.list("-created_at"),
    appClient.entities.Client.list(),
    appClient.entities.ActionItem.list("-created_at"),
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

  const openItems = allItems.filter((i) => i.status === "open");
  const dataChanged = dataTimestamp > lastScanData || openItems.length === 0;

  if (!dataChanged) return;

  // Partition stored items by status
  const dismissedKeys = new Set(
    allItems
      .filter((i) => i.status === "dismissed")
      .map((i) => i.candidate_key || i.payload?.candidate_key || `${i.item_type}::${i.entity_id}`)
  );
  const now = Date.now();
  const snoozedKeys = new Set(
    allItems
      .filter((i) => i.status === "snoozed" && i.snoozed_until && new Date(i.snoozed_until).getTime() > now)
      .map((i) => i.candidate_key || i.payload?.candidate_key || `${i.item_type}::${i.entity_id}`)
  );

  const profile = await getAssistantProfile();
  const contextNotes = profile?.context_notes || "";
  const hasContextNotes = typeof contextNotes === "string" && contextNotes.trim().length > 0;

  const candidates = extractCandidateFindings(events, documents, clients, now);

  let desired = [];
  let aiSucceeded = false;

  if (hasContextNotes && !isPreviewModeEnabled()) {
    try {
      // Pre-filter candidates on client-side to save tokens
      const activeCandidates = candidates.filter((c) => {
        const key = c.candidate_key || `${c.item_type}::${c.entity_id}`;
        return !dismissedKeys.has(key) && !snoozedKeys.has(key);
      });

      const response = await flowtoneJson("/api/ai/compose-missions", {
        method: "POST",
        body: JSON.stringify({
          candidates: activeCandidates,
          context_notes: contextNotes,
          name: profile?.user_name || "",
          language: profile?.language || DEFAULT_LANGUAGE,
          assistantName: profile?.assistant_name || "",
        }),
      });

      if (response && Array.isArray(response.items)) {
        aiSucceeded = true;
        desired = response.items.map((item) => {
          const matchingCandidate = candidates.find(c => c.candidate_key === item.key);
          
          let selectedType = item.item_type;
          if (!matchingCandidate?.allowed_item_types.includes(selectedType)) {
            selectedType = matchingCandidate?.default_item_type || "gig_missing_location";
          }
          const target = matchingCandidate?.action_targets?.[selectedType] || "";

          return {
            candidate_key: item.key,
            item_type: selectedType,
            entity_type: matchingCandidate?.entity_type || "event",
            entity_id: matchingCandidate?.entity_id || "",
            title: item.title,
            priority: typeof item.priority === "number" ? Math.max(0, Math.min(2, item.priority)) : 1,
            action_type: "navigate",
            action_target: target,
            payload: {
              ...(matchingCandidate?.payload || {}),
              candidate_key: item.key,
            },
          };
        });
      }
    } catch (err) {
      console.warn("missionScanRunner: AI scan failed, falling back to local scan", err);
    }
  }

  // Fallback / default path
  if (!aiSucceeded) {
    desired = scanForActionItems(events, documents, clients, now);
  }

  const { toCreate: rawCreate, toResolve, toRefresh } = reconcileActionItems(openItems, desired);

  // Suppress items that are permanently dismissed or currently snoozed
  const toCreate = rawCreate.filter((d) => {
    const key = d.candidate_key || `${d.item_type}::${d.entity_id}`;
    return !dismissedKeys.has(key) && !snoozedKeys.has(key);
  });

  // Re-open expired snoozes: find snoozed items that are back in desired and snooze has expired
  const expiredSnoozes = allItems.filter((i) => {
    if (i.status !== "snoozed") return false;
    if (i.snoozed_until && new Date(i.snoozed_until).getTime() > now) return false;
    const key = i.candidate_key || i.payload?.candidate_key || `${i.item_type}::${i.entity_id}`;
    return desired.some((d) => (d.candidate_key || `${d.item_type}::${d.entity_id}`) === key);
  });

  if (toCreate.length === 0 && toResolve.length === 0 && toRefresh.length === 0 && expiredSnoozes.length === 0) {
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

  // Re-open expired snoozes
  for (const item of expiredSnoozes) {
    await appClient.entities.ActionItem.update(item.id, {
      status: "open",
      snoozed_until: null,
    }).catch(() => {});
  }

  // If AI did not run for decisioning, but we have new/refreshed items,
  // we still call AI to compose natural titles (legacy behavior).
  let titles = {};
  if (!aiSucceeded && !isPreviewModeEnabled()) {
    const needsComposition = [...toCreate, ...toRefresh.map((r) => r.desired)];
    if (needsComposition.length > 0) {
      try {
        const result = await flowtoneJson("/api/ai/compose-missions", {
          method: "POST",
          body: JSON.stringify({
            items: needsComposition,
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
  }

  // Create new items
  for (const item of toCreate) {
    const key = item.candidate_key || `${item.item_type}::${item.entity_id}`;
    const aiTitle = aiSucceeded ? item.title : titles[key];
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
      payload: {
        ...(item.payload || {}),
        candidate_key: key,
      },
    }).catch(() => {});
  }

  // Refresh items with stale payload
  for (const { existing, desired: d } of toRefresh) {
    const key = d.candidate_key || `${d.item_type}::${d.entity_id}`;
    const aiTitle = aiSucceeded ? d.title : titles[key];
    const fallbackTitle = buildFallbackTitle(d);

    await appClient.entities.ActionItem.update(existing.id, {
      title: aiTitle || fallbackTitle,
      payload: {
        ...(d.payload || {}),
        candidate_key: key,
      },
      priority: d.priority,
      action_type: d.action_type,
      action_target: d.action_target,
    }).catch(() => {});
  }

  try { localStorage.setItem("flowtone_mission_scan_data_at", String(dataTimestamp)); } catch { /* ignore */ }
}

function buildFallbackTitle(item) {
  const p = item.payload || {};
  switch (item.item_type) {
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
    case "invoice_ready_no_email":
      return `Invoice for ${p.client_name || "a client"} is ready — no email, grab the PDF`;
    default:
      return "Action needed";
  }
}
