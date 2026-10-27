// Reads .xlsx / .xls / .csv / .numbers into plain rows. SheetJS is loaded on
// demand so the rest of the app never pays for it.

const pad = (n) => String(n).padStart(2, "0");

// Beyond this many lines a file is not a gig list; reading on would only
// risk the phone running out of memory.
const MAX_ROWS = 20000;

/**
 * → { sheets: [{ name, headers: string[], rows: object[], lines: number[] }] },
 * sheets with the most data first. Header row = first row with 2+ text cells
 * (exports often start with a title row). Date-formatted cells become
 * "yyyy-MM-dd". lines[i] is rows[i]'s line number in the spreadsheet, so the
 * screen can point at the right line even past title and blank rows.
 */
export async function readSpreadsheet(file) {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = isPlainText(file)
    // Text files are read as text, every cell kept as written: SheetJS would
    // otherwise turn "03/04/2026" into 4 March (US order) before parseDate's
    // UK day-first reading ever sees it.
    ? XLSX.read(decodeText(buf), { type: "string", raw: true, sheetRows: MAX_ROWS })
    // cellNF keeps each cell's number format, which is how a date cell (stored
    // as a day count like 45956) is told apart from a plain number.
    : XLSX.read(buf, { type: "array", cellDates: false, cellNF: true, sheetRows: MAX_ROWS });
  // Numbers files (and some Mac Excel ones) count days from 1904, not 1900.
  const date1904 = !!wb.Workbook?.WBProps?.date1904;

  const sheets = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name] || {};
    // Only the cells that exist: a file's declared range can reach row
    // 1,048,576 while it holds a handful of gigs.
    const byRow = new Map();
    for (const addr of Object.keys(ws)) {
      if (addr[0] === "!") continue;
      const v = cellValue(XLSX, ws[addr], date1904);
      if (v === null || String(v).trim() === "") continue;
      const { r, c } = XLSX.utils.decode_cell(addr);
      if (!byRow.has(r)) byRow.set(r, new Map());
      byRow.get(r).set(c, v);
    }
    const rowNums = [...byRow.keys()].sort((a, b) => a - b);
    const headerRow = rowNums.find((r) => [...byRow.get(r).values()].filter((v) => typeof v === "string").length >= 2);
    if (headerRow === undefined) return { name, headers: [], rows: [], lines: [] };
    const dataRows = rowNums.filter((r) => r > headerRow);
    const cols = [...new Set([headerRow, ...dataRows].flatMap((r) => [...byRow.get(r).keys()]))].sort((a, b) => a - b);
    const seen = {};
    const headers = cols.map((c) => {
      let label = String(byRow.get(headerRow).get(c) ?? "").trim() || `Column ${XLSX.utils.encode_col(c)}`;
      if (seen[label]) label = `${label} (${++seen[label]})`;
      else seen[label] = 1;
      return label;
    });
    const rows = dataRows.map((r) => Object.fromEntries(cols.map((c, i) => [headers[i], byRow.get(r).get(c) ?? null])));
    return { name, headers, rows, lines: dataRows.map((r) => r + 1) };
  });

  sheets.sort((a, b) => b.rows.length - a.rows.length);
  return { sheets: sheets.filter((s) => s.rows.length) };
}

function isPlainText(file) {
  return /\.(csv|tsv|txt)$/i.test(file.name || "") || /^text\//.test(file.type || "");
}

// UTF-8 when it is valid UTF-8, else Windows-1252 (Excel's "CSV" on Windows,
// where £ is a single byte).
function decodeText(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function cellValue(XLSX, cell, date1904) {
  if (!cell || cell.t === "e") return null; // #N/A, #REF! and the like
  if (cell.t === "n" && cell.z && XLSX.SSF.is_date(cell.z)) {
    const d = XLSX.SSF.parse_date_code(cell.v, { date1904 });
    if (d) return `${d.y}-${pad(d.m)}-${pad(d.d)}`;
  }
  if (cell.t === "d" && cell.v instanceof Date) {
    const d = cell.v;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  if (cell.t === "s") return cell.v.trim() || null;
  return cell.v ?? null;
}
