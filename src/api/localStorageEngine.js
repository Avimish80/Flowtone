import { ENTITY_COLUMNS, ENTITY_CONFIG } from "@/api/entityMetadata";
import { getSupabaseClient, isPreviewModeEnabled, isSupabaseConfigured } from "@/lib/supabaseClient";

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

function hydrateRow(row) {
  if (!row) return null;
  const { payload, user_id: _userId, ...rest } = row;
  return {
    ...(payload || {}),
    ...rest,
  };
}

function splitRecord(entityName, record = {}) {
  const knownColumns = ENTITY_COLUMNS[entityName];
  const payload = {};
  const row = {};

  for (const [key, value] of Object.entries(record)) {
    if (knownColumns.has(key)) {
      row[key] = value;
    } else {
      payload[key] = value;
    }
  }

  return { row, payload };
}

async function requireSupabase() {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
  }

  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const session = data.session;

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

      let records = (data || []).map(hydrateRow);
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

      let records = (data || []).map(hydrateRow);
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
      return hydrateRow(data);
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
      return (data || []).map(hydrateRow);
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
        ...hydrateRow(existing),
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
      return hydrateRow(data);
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
