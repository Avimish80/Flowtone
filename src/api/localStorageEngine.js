import { ENTITY_COLUMNS, ENTITY_CONFIG } from "@/api/entityMetadata";
import { getSupabaseClient, getSessionSafe, isPreviewModeEnabled, isSupabaseConfigured } from "@/lib/supabaseClient";

function generateId() {
  return crypto.randomUUID();
}

function getPreviewStore(entityName) {
  const raw = localStorage.getItem(`musician_os_${entityName}`);
  return raw ? JSON.parse(raw) : [];
}

function setPreviewStore(entityName, records) {
  localStorage.setItem(`musician_os_${entityName}`, JSON.stringify(records));
}

function getEntityConfig(entityName) {
  const config = ENTITY_CONFIG[entityName];
  if (!config) throw new Error(`Unknown entity config: ${entityName}`);
  return config;
}

function comparePrimitiveValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function sortRecords(records, sortField) {
  if (!sortField) return [...records];
  const desc = sortField.startsWith("-");
  const field = desc ? sortField.slice(1) : sortField;

  return [...records].sort((a, b) => {
    const result = comparePrimitiveValues(a[field], b[field]);
    return desc ? -result : result;
  });
}

function matchesExact(rowValue, queryValue) {
  if (Array.isArray(queryValue) || (queryValue && typeof queryValue === "object")) {
    return JSON.stringify(rowValue) === JSON.stringify(queryValue);
  }
  return rowValue === queryValue;
}

// Entities whose records carry their own `payload` object (read as
// item.payload.*). For these the jsonb column IS that object, so it is nested
// back under `payload` on read instead of being spread onto the record.
const NESTED_PAYLOAD_ENTITIES = new Set(["ActionItem"]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hydrateRow(row, entityName) {
  if (!row) return null;
  const { payload, user_id: _userId, ...rest } = row;
  if (NESTED_PAYLOAD_ENTITIES.has(entityName)) {
    return {
      ...rest,
      payload: isPlainObject(payload) ? payload : {},
    };
  }
  return {
    ...(payload || {}),
    ...rest,
  };
}

// Nullable uuid foreign-key columns. Postgres rejects "" on a uuid column
// ("invalid input syntax for type uuid"), so blank ids must become null —
// otherwise creating an event/invoice/etc. with no linked record crashes.
const UUID_FK_COLUMNS = new Set([
  "client_id", "work_event_id", "linked_gig_id", "document_id",
  "converted_from_id", "practice_goal_id", "practice_session_id",
  "goal_id", "linked_entity_id", "entity_id",
]);

function splitRecord(entityName, record = {}) {
  const knownColumns = ENTITY_COLUMNS[entityName];
  const payload = {};
  const row = {};

  for (const [key, value] of Object.entries(record)) {
    if (knownColumns.has(key)) {
      row[key] = UUID_FK_COLUMNS.has(key) && (value === "" || value === undefined)
        ? null
        : value;
    } else {
      payload[key] = value;
    }
  }

  // The record's own payload object is the column value; any unknown keys
  // passed alongside it are merged in. Without this the (empty) leftover object
  // replaced it on every write and the item lost all its details.
  if (NESTED_PAYLOAD_ENTITIES.has(entityName)) {
    const own = isPlainObject(row.payload) ? row.payload : {};
    delete row.payload;
    return { row, payload: { ...own, ...payload } };
  }

  return { row, payload };
}

async function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  const supabase = getSupabaseClient();
  const session = await getSessionSafe();

  if (!session?.user) {
    throw new Error("Authentication required");
  }

  return { supabase, session };
}

function buildServerQuery(supabase, entityName, queryObj = {}, sortField) {
  const { table } = getEntityConfig(entityName);
  const knownColumns = ENTITY_COLUMNS[entityName];
  let query = supabase.from(table).select("*");

  Object.entries(queryObj).forEach(([key, value]) => {
    if (knownColumns.has(key)) {
      query = query.eq(key, value);
    }
  });

  if (sortField) {
    const desc = sortField.startsWith("-");
    const field = desc ? sortField.slice(1) : sortField;
    if (knownColumns.has(field)) {
      query = query.order(field, { ascending: !desc });
    }
  }

  return query;
}

export function createLocalEntity(entityName) {
  const { table } = getEntityConfig(entityName);
  const usePreviewStore = () => isPreviewModeEnabled();

  return {
    async list(sortField, limit) {
      if (usePreviewStore()) {
        let records = getPreviewStore(entityName);
        records = sortRecords(records, sortField);
        if (limit) records = records.slice(0, limit);
        return records;
      }

      const { supabase } = await requireSupabase();
      const { data, error } = await buildServerQuery(supabase, entityName, {}, sortField);

      if (error) throw error;

      let records = (data || []).map((row) => hydrateRow(row, entityName));
      records = sortRecords(records, sortField);
      if (limit) records = records.slice(0, limit);
      return records;
    },

    async filter(queryObj = {}, sortField, limit) {
      if (usePreviewStore()) {
        let records = getPreviewStore(entityName);
        records = records.filter((record) =>
          Object.entries(queryObj).every(([key, value]) => matchesExact(record[key], value))
        );
        records = sortRecords(records, sortField);
        if (limit) records = records.slice(0, limit);
        return records;
      }

      const { supabase } = await requireSupabase();
      const { data, error } = await buildServerQuery(supabase, entityName, queryObj, sortField);

      if (error) throw error;

      let records = (data || []).map((row) => hydrateRow(row, entityName));
      records = records.filter((record) =>
        Object.entries(queryObj).every(([key, value]) => matchesExact(record[key], value))
      );
      records = sortRecords(records, sortField);
      if (limit) records = records.slice(0, limit);
      return records;
    },

    async create(record) {
      if (usePreviewStore()) {
        const records = getPreviewStore(entityName);
        const now = new Date().toISOString();
        const nextRecord = {
          ...record,
          id: record.id || generateId(),
          created_at: record.created_at || now,
          updated_at: now,
        };
        records.push(nextRecord);
        setPreviewStore(entityName, records);
        return nextRecord;
      }

      const { supabase, session } = await requireSupabase();
      const now = new Date().toISOString();
      const { row, payload } = splitRecord(entityName, record);
      const insertRow = {
        ...row,
        id: row.id || generateId(),
        user_id: session.user.id,
        created_at: row.created_at || now,
        updated_at: now,
        payload,
      };

      const { data, error } = await supabase
        .from(table)
        .insert(insertRow)
        .select("*")
        .single();

      if (error) throw error;
      return hydrateRow(data, entityName);
    },

    async createMany(records = []) {
      if (!records.length) return [];

      if (usePreviewStore()) {
        const existing = getPreviewStore(entityName);
        const now = new Date().toISOString();
        const nextRecords = records.map((record) => ({
          ...record,
          id: record.id || generateId(),
          created_at: record.created_at || now,
          updated_at: record.updated_at || now,
        }));
        setPreviewStore(entityName, [...existing, ...nextRecords]);
        return nextRecords;
      }

      const { supabase, session } = await requireSupabase();
      const now = new Date().toISOString();

      const rows = records.map((record) => {
        const { row, payload } = splitRecord(entityName, record);
        return {
          ...row,
          id: row.id || generateId(),
          user_id: session.user.id,
          created_at: row.created_at || now,
          updated_at: row.updated_at || now,
          payload,
        };
      });

      const { data, error } = await supabase
        .from(table)
        .insert(rows)
        .select("*");

      if (error) throw error;
      return (data || []).map((row) => hydrateRow(row, entityName));
    },

    async update(id, updates) {
      if (usePreviewStore()) {
        const records = getPreviewStore(entityName);
        const idx = records.findIndex((record) => record.id === id);
        if (idx === -1) throw new Error(`${entityName} with id ${id} not found`);
        records[idx] = {
          ...records[idx],
          ...updates,
          updated_at: new Date().toISOString(),
        };
        setPreviewStore(entityName, records);
        return records[idx];
      }

      const { supabase } = await requireSupabase();
      const { data: existing, error: existingError } = await supabase
        .from(table)
        .select("*")
        .eq("id", id)
        .single();

      if (existingError) throw existingError;

      const merged = {
        ...hydrateRow(existing, entityName),
        ...updates,
        id,
        created_at: existing.created_at,
        updated_at: new Date().toISOString(),
      };

      const { row, payload } = splitRecord(entityName, merged);
      const updateRow = {
        ...row,
        payload,
        updated_at: merged.updated_at,
      };

      const { id: _id, user_id: _userId, ...safeUpdateRow } = updateRow;

      const { data, error } = await supabase
        .from(table)
        .update(safeUpdateRow)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      return hydrateRow(data, entityName);
    },

    async delete(id) {
      if (usePreviewStore()) {
        const records = getPreviewStore(entityName).filter((record) => record.id !== id);
        setPreviewStore(entityName, records);
        return { success: true };
      }

      const { supabase } = await requireSupabase();
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { success: true };
    },
  };
}
