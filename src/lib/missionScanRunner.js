import { appClient } from "@/api/appClient";
import {
  scanForActionItems, reconcileActionItems, extractCandidateFindings,
  groupActionItems, groupTitle, isGroupItem, itemKey,
} from "@/lib/actionItemScanner";
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";
import { getAssistantProfile, DEFAULT_LANGUAGE } from "@/lib/assistantProfile";

// The server writes titles in batches of ~15 (a few model calls in a row for a
// long list), so allow longer than the default 15s request timeout.
const COMPOSE_TIMEOUT_MS = 60000;

// Data timestamp at which the empty-payload refill was last attempted, so a
// refill that cannot complete does not force a full scan on every open.
const BACKFILL_TRIED_KEY = "flowtone_mission_backfill_tried_at";

function latestUpdatedAt(records) {
  let max = 0;
  for (const r of records) {
    const t = new Date(r.updated_at || r.created_at || 0).getTime();
    if (t > max) max = t;
  }
  return max;
}

export async function runMissionScan() {
  const [events, documents, clients, allItems, leads] = await Promise.all([
    appClient.entities.WorkEvent.list("date"),
    appClient.entities.Document.list("-created_at"),
    appClient.entities.Client.list(),
    appClient.entities.ActionItem.list("-created_at"),
    appClient.entities.Lead.list("-created_at"),
  ]);

  const dataTimestamp = Math.max(
    latestUpdatedAt(events),
    latestUpdatedAt(documents),
    latestUpdatedAt(clients),
    latestUpdatedAt(leads)
  );

  let lastScanData = 0;
  let backfillTriedAt = 0;
  try {
    lastScanData = Number(localStorage.getItem("flowtone_mission_scan_data_at") || 0);
    backfillTriedAt = Number(localStorage.getItem(BACKFILL_TRIED_KEY) || 0);
  } catch { /* ignore */ }

  const now = Date.now();
  // "grouped" items are live too — just folded into a group item for display.
  const activeItems = allItems.filter((i) => i.status === "open" || i.status === "grouped");
  // A deferred (snoozed) task whose follow-up date has passed must wake up even
  // if nothing else changed — otherwise it could stay buried until the next edit.
  const hasDueSnooze = allItems.some(
    (i) => i.status === "snoozed" && i.snoozed_until && new Date(i.snoozed_until).getTime() <= now
  );
  // Items saved without their details (an old data-layer bug wrote an empty
  // payload) must be refilled — once per data state, so it can never loop.
  const needsBackfill = activeItems.some((i) => !i.payload?.payload_sig);
  const backfillDue = needsBackfill && backfillTriedAt !== dataTimestamp;
  const dataChanged = dataTimestamp > lastScanData || activeItems.length === 0 || hasDueSnooze || backfillDue;

  if (!dataChanged) return;

  const markScanned = () => {
    try {
      localStorage.setItem("flowtone_mission_scan_data_at", String(dataTimestamp));
      if (needsBackfill) localStorage.setItem(BACKFILL_TRIED_KEY, String(dataTimestamp));
    } catch { /* ignore */ }
  };

  // Partition stored items by status
  const dismissedKeys = new Set(
    allItems.filter((i) => i.status === "dismissed").map(itemKey)
  );
  const snoozedKeys = new Set(
    allItems
      .filter((i) => i.status === "snoozed" && i.snoozed_until && new Date(i.snoozed_until).getTime() > now)
      .map(itemKey)
  );

  const profile = await getAssistantProfile();
  const contextNotes = profile?.context_notes || "";
  const hasContextNotes = typeof contextNotes === "string" && contextNotes.trim().length > 0;

  const candidates = extractCandidateFindings(events, documents, clients, now, leads);

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
        timeoutMs: COMPOSE_TIMEOUT_MS,
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
            priority: typeof item.priority === "number"
              ? Math.max(0, Math.min(2, item.priority))
              : (matchingCandidate?.priority ?? 1),
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
    desired = scanForActionItems(events, documents, clients, now, leads);
  }

  // Fold piles of same-kind tasks into one group item. Skipped or deferred
  // tasks don't count towards a group.
  const groupable = desired.filter((d) => !dismissedKeys.has(itemKey(d)) && !snoozedKeys.has(itemKey(d)));
  const { groups, groupedKeys } = groupActionItems(groupable);
  for (const d of desired) d.desired_status = groupedKeys.has(itemKey(d)) ? "grouped" : "open";
  for (const g of groups) g.desired_status = "open";
  const target = [...desired, ...groups];
  const desiredByKey = new Map(target.map((d) => [itemKey(d), d]));

  const { toCreate: rawCreate, toResolve, toRefresh, toRestatus } = reconcileActionItems(activeItems, target);

  // Re-open expired snoozes: find snoozed items that are back in desired and snooze has expired
  const expiredSnoozes = allItems.filter((i) => {
    if (i.status !== "snoozed") return false;
    if (i.snoozed_until && new Date(i.snoozed_until).getTime() > now) return false;
    return desiredByKey.has(itemKey(i));
  });
  const reopenedKeys = new Set(expiredSnoozes.map(itemKey));

  // Suppress items that are permanently dismissed or currently snoozed, and
  // items that come back by re-opening their snoozed row (never a second copy).
  const toCreate = rawCreate.filter((d) => {
    const key = itemKey(d);
    return !dismissedKeys.has(key) && !snoozedKeys.has(key) && !reopenedKeys.has(key);
  });

  if (toCreate.length === 0 && toResolve.length === 0 && toRefresh.length === 0 &&
      toRestatus.length === 0 && expiredSnoozes.length === 0) {
    markScanned();
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

  // Re-open expired snoozes (clear the AI's deferred label — it's active again).
  // Details may have moved on while it slept (a group's count), so bring them up to date.
  for (const item of expiredSnoozes) {
    const d = desiredByKey.get(itemKey(item));
    const updates = {
      status: d?.desired_status || "open",
      snoozed_until: null,
      decision: "",
    };
    if (d && (item.payload?.payload_sig || "") !== (d.payload?.payload_sig || "")) {
      updates.payload = { ...(item.payload || {}), ...(d.payload || {}), candidate_key: itemKey(d) };
      if (isGroupItem(d)) updates.title = groupTitle(d);
    }
    await appClient.entities.ActionItem.update(item.id, updates).catch(() => {});
  }

  // If AI did not run for decisioning, but we have new/refreshed items,
  // we still call AI to compose natural titles (legacy behavior). Only items
  // that will be shown on their own need one; groups have exact code titles.
  let titles = {};
  const surfacing = new Map();
  for (const d of [
    ...toCreate,
    ...toRefresh.map((r) => r.desired),
    ...toRestatus.filter((r) => r.desired.desired_status === "open").map((r) => r.desired),
  ]) {
    if (d.desired_status === "open" && !isGroupItem(d)) surfacing.set(itemKey(d), d);
  }
  if (!aiSucceeded && !isPreviewModeEnabled() && surfacing.size > 0) {
    try {
      const result = await flowtoneJson("/api/ai/compose-missions", {
        method: "POST",
        timeoutMs: COMPOSE_TIMEOUT_MS,
        body: JSON.stringify({
          items: [...surfacing.values()],
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

  const titleFor = (d, existingTitle = "") => {
    if (isGroupItem(d)) return groupTitle(d);
    const key = itemKey(d);
    const aiTitle = aiSucceeded ? d.title : titles[key];
    // A grouped member keeps whatever it had; it is out of sight until it surfaces.
    if (!aiTitle && d.desired_status === "grouped" && existingTitle) return existingTitle;
    return aiTitle || buildFallbackTitle(d);
  };

  // Create new items
  for (const item of toCreate) {
    const key = itemKey(item);
    await appClient.entities.ActionItem.create({
      item_type: item.item_type,
      entity_type: item.entity_type,
      entity_id: item.entity_id,
      title: titleFor(item),
      priority: item.priority,
      status: item.desired_status || "open",
      action_type: item.action_type,
      action_target: item.action_target,
      payload: {
        ...(item.payload || {}),
        candidate_key: key,
      },
    }).catch(() => {});
  }

  // Refresh items with stale payload (and move them in or out of a group)
  const refreshed = new Set();
  for (const { existing, desired: d } of toRefresh) {
    const key = itemKey(d);
    refreshed.add(existing.id);
    await appClient.entities.ActionItem.update(existing.id, {
      title: titleFor(d, existing.title),
      payload: {
        ...(d.payload || {}),
        candidate_key: key,
      },
      priority: d.priority,
      status: d.desired_status || existing.status,
      action_type: d.action_type,
      action_target: d.action_target,
    }).catch(() => {});
  }

  // Status-only moves: a group formed or shrank, payload unchanged
  for (const { existing, desired: d } of toRestatus) {
    if (refreshed.has(existing.id)) continue;
    const updates = { status: d.desired_status };
    if (d.desired_status === "open" && titles[itemKey(d)]) updates.title = titles[itemKey(d)];
    await appClient.entities.ActionItem.update(existing.id, updates).catch(() => {});
  }

  markScanned();
}

function buildFallbackTitle(item) {
  const p = item.payload || {};
  switch (item.item_type) {
    case "gig_missing_location":
      return `Add a location for ${p.event_title || "your gig"}`;
    case "gig_missing_fee":
      return `Set the fee for ${p.event_title || "your gig"}`;
    case "gig_missing_client":
      return `Add the client for ${p.event_title || "your gig"} so I can invoice it`;
    case "gig_missing_contact":
      return `Add an email for ${p.client_name || "the client"} to send their invoice`;
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
    case "lead_new_unanswered":
      return `New lead from ${p.client_name || "someone"} is waiting for a reply`;
    case "lead_quote_no_reply":
      return `${p.client_name || "A lead"} hasn't replied to your quote — chase it?`;
    default:
      return "Action needed";
  }
}
