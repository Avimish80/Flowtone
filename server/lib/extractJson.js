// The model is told to return one bare JSON object, but it occasionally wraps
// it in code fences or prefixes it with a line of prose. A plain JSON.parse
// fails on those, and falling back to the raw string puts `{"message":...}`
// straight into the user's chat bubble. So: scan for the first balanced
// {...} object and parse that instead.
export function extractJsonObject(rawText) {
  const text = String(rawText || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(text);
  } catch { /* not bare JSON — scan for the object below */ }

  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}
