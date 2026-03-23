function generateId() {
  return crypto.randomUUID();
}

function getStore(entityName) {
  const raw = localStorage.getItem(`musician_os_${entityName}`);
  return raw ? JSON.parse(raw) : [];
}

function setStore(entityName, records) {
  localStorage.setItem(`musician_os_${entityName}`, JSON.stringify(records));
}

function sortRecords(records, sortField) {
  if (!sortField) return records;
  const desc = sortField.startsWith('-');
  const field = desc ? sortField.slice(1) : sortField;
  return [...records].sort((a, b) => {
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (av < bv) return desc ? 1 : -1;
    if (av > bv) return desc ? -1 : 1;
    return 0;
  });
}

export function createLocalEntity(entityName) {
  return {
    async list(sortField, limit) {
      let records = getStore(entityName);
      records = sortRecords(records, sortField);
      if (limit) records = records.slice(0, limit);
      return records;
    },

    async filter(queryObj, sortField) {
      let records = getStore(entityName);
      records = records.filter(r =>
        Object.entries(queryObj).every(([k, v]) => r[k] === v)
      );
      records = sortRecords(records, sortField);
      return records;
    },

    async create(data) {
      const records = getStore(entityName);
      const now = new Date().toISOString();
      const newRecord = {
        ...data,
        id: generateId(),
        created_at: now,
        updated_at: now,
      };
      records.push(newRecord);
      setStore(entityName, records);
      return newRecord;
    },

    async update(id, data) {
      const records = getStore(entityName);
      const idx = records.findIndex(r => r.id === id);
      if (idx === -1) throw new Error(`${entityName} with id ${id} not found`);
      records[idx] = {
        ...records[idx],
        ...data,
        updated_at: new Date().toISOString(),
      };
      setStore(entityName, records);
      return records[idx];
    },

    async delete(id) {
      let records = getStore(entityName);
      records = records.filter(r => r.id !== id);
      setStore(entityName, records);
      return { success: true };
    },
  };
}
