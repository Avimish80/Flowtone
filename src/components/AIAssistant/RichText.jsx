/**
 * RichText — renders the assistant's message the way it was written.
 *
 * The AI answers in a tight house format (see the "HOW TO WRITE THE MESSAGE"
 * section of the server system prompt): a lead line, then one record per line
 * starting with "- ", fields separated by " · ", then a closing line.
 *
 * Without this, React renders the raw string and the browser collapses every
 * newline into a space — eight lessons become one unreadable paragraph.
 *
 * Deliberately tiny: no markdown dependency, only the marks the prompt allows.
 */

// Inline **bold** — everything else is literal text.
function inline(text, keyPrefix) {
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

/**
 * A list row. The first field is the row's identifier (date, invoice number,
 * client name) so it carries the emphasis; the rest are supporting detail.
 */
function Row({ text, index }) {
  const fields = text.split(" · ");
  const lead = fields[0];
  const rest = fields.slice(1).join(" · ");

  return (
    <li className="flex items-baseline gap-2">
      <span className="flex-shrink-0 w-1 h-1 rounded-full bg-gray-500 translate-y-[-2px]" />
      <span className="min-w-0">
        <span className="text-white">{inline(lead, `r${index}l`)}</span>
        {rest && (
          <span className="text-gray-400"> · {inline(rest, `r${index}r`)}</span>
        )}
      </span>
    </li>
  );
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;

export function hasList(text) {
  return String(text || "")
    .split("\n")
    .some((line) => BULLET.test(line));
}

export default function RichText({ text }) {
  const lines = String(text || "").split("\n");

  // Group consecutive bullet lines into one list; everything else is a paragraph.
  const blocks = [];
  lines.forEach((line) => {
    const bullet = line.match(BULLET);
    const last = blocks[blocks.length - 1];

    if (bullet) {
      if (last?.type === "list") last.items.push(bullet[1]);
      else blocks.push({ type: "list", items: [bullet[1]] });
      return;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      // Blank line closes the current block so the next text starts fresh.
      if (last) last.closed = true;
      return;
    }

    if (last?.type === "text" && !last.closed) last.lines.push(trimmed);
    else blocks.push({ type: "text", lines: [trimmed] });
  });

  if (!blocks.length) return null;

  return (
    <div className="space-y-2">
      {blocks.map((block, i) =>
        block.type === "list" ? (
          <ul key={i} className="space-y-1.5">
            {block.items.map((item, j) => (
              <Row key={j} text={item} index={`${i}-${j}`} />
            ))}
          </ul>
        ) : (
          <p key={i}>
            {block.lines.map((line, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(line, `${i}-${j}`)}
              </span>
            ))}
          </p>
        )
      )}
    </div>
  );
}
