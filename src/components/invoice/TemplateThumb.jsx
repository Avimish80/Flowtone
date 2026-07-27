/**
 * TemplateThumb — a small true-to-layout preview of each invoice template.
 *
 * The previous picker drew one identical wireframe six times and only swapped
 * the fill colour, which made five different documents look like one document
 * in five colours. Each thumbnail here mirrors the structure of the template
 * it stands for, so the choice is legible before you open the full preview.
 */

const PAPER = "#ffffff";
const INK = "#14171c";
const HAIR = "#dfe3e9";
const MUTE = "#aeb4bd";
const WASH = "#f2f4f7";

// Repeated line-item rules — the body of every layout.
function Lines({ x, y, w, count = 4, gap = 4, colour = HAIR }) {
  return Array.from({ length: count }, (_, i) => (
    <rect key={i} x={x} y={y + i * gap} width={w} height="1.1" fill={colour} rx="0.5" />
  ));
}

export default function TemplateThumb({ id, accent = "#1c3a5e", width = 46, height = 60 }) {
  const common = { width, height, viewBox: "0 0 40 52", fill: "none", className: "rounded-[3px]" };
  const paper = <rect width="40" height="52" fill={PAPER} rx="2" />;

  // 1 — Simple: name left, number right, plain rules. No accent anywhere.
  if (id === 1) {
    return (
      <svg {...common}>
        {paper}
        <rect x="4" y="5" width="13" height="2.4" fill={INK} rx="1" />
        <rect x="4" y="9" width="9" height="1.2" fill={MUTE} rx="0.6" />
        <rect x="28" y="5" width="8" height="1.6" fill={MUTE} rx="0.8" />
        <rect x="30" y="8.5" width="6" height="2" fill={INK} rx="1" />
        <rect x="4" y="15" width="32" height="0.8" fill={HAIR} />
        <rect x="4" y="18" width="10" height="1.8" fill={INK} rx="0.9" />
        <rect x="22" y="18" width="6" height="1.4" fill={MUTE} rx="0.7" />
        <rect x="30" y="18" width="6" height="1.4" fill={MUTE} rx="0.7" />
        <rect x="4" y="23.5" width="32" height="0.8" fill={HAIR} />
        <Lines x={4} y={27} w={32} count={4} gap={4} />
        <rect x="24" y="45" width="12" height="1.4" fill={INK} rx="0.7" />
      </svg>
    );
  }

  // 2 — Atelier: centred wordmark, accent hairline, big serif number, band total.
  if (id === 2) {
    return (
      <svg {...common}>
        {paper}
        <rect x="11" y="6" width="18" height="1.8" fill={INK} rx="0.9" />
        <rect x="17" y="10" width="6" height="1" fill={accent} rx="0.5" />
        <rect x="14" y="13" width="12" height="0.9" fill={MUTE} rx="0.45" />
        <rect x="5" y="20" width="11" height="3.4" fill={INK} rx="1" />
        <rect x="5" y="26" width="30" height="0.9" fill={INK} />
        <Lines x={5} y={31} w={30} count={3} gap={5} />
        <rect x="5" y="43" width="30" height="0.9" fill={INK} />
        <rect x="22" y="45.5" width="13" height="2.6" fill={accent} rx="1" />
        <rect x="5" y="49.5" width="30" height="0.9" fill={INK} />
      </svg>
    );
  }

  // 3 — Statement: one solid colour block, then air.
  if (id === 3) {
    return (
      <svg {...common}>
        {paper}
        <rect x="3" y="3" width="34" height="13" fill={accent} rx="1" />
        <rect x="6" y="6" width="13" height="2.2" fill="#fff" opacity="0.95" rx="1" />
        <rect x="6" y="9.6" width="9" height="1.1" fill="#fff" opacity="0.5" rx="0.55" />
        <rect x="27" y="6" width="7" height="1.4" fill="#fff" opacity="0.55" rx="0.7" />
        <rect x="28" y="9.2" width="6" height="1.8" fill="#fff" opacity="0.95" rx="0.9" />
        <rect x="3" y="20" width="10" height="1.6" fill={INK} rx="0.8" />
        <rect x="17" y="20" width="7" height="1.3" fill={MUTE} rx="0.65" />
        <rect x="28" y="20" width="7" height="1.3" fill={MUTE} rx="0.65" />
        <rect x="3" y="26" width="34" height="3" fill={accent} opacity="0.12" rx="0.6" />
        <Lines x={3} y={31.5} w={34} count={3} gap={4} />
        <rect x="23" y="44" width="14" height="2.4" fill={accent} rx="1" />
      </svg>
    );
  }

  // 4 — Column: tinted side rail with an accent edge, work on the right.
  if (id === 4) {
    return (
      <svg {...common}>
        {paper}
        <rect x="0" y="0" width="14" height="52" fill={WASH} />
        <rect x="0" y="0" width="1.6" height="52" fill={accent} />
        <rect x="4" y="5" width="8" height="2" fill={INK} rx="1" />
        <rect x="4" y="9" width="6.5" height="1" fill={MUTE} rx="0.5" />
        <rect x="4" y="16" width="5" height="1" fill={MUTE} rx="0.5" />
        <rect x="4" y="19" width="8" height="1.4" fill={INK} rx="0.7" />
        <rect x="4" y="26" width="5" height="1" fill={MUTE} rx="0.5" />
        <rect x="4" y="29" width="7" height="1.4" fill={INK} rx="0.7" />
        <rect x="4" y="36" width="5" height="1" fill={MUTE} rx="0.5" />
        <rect x="4" y="39" width="8" height="1.2" fill={INK} rx="0.6" />
        <rect x="18" y="5" width="6" height="1.3" fill={MUTE} rx="0.65" />
        <rect x="18" y="8.4" width="11" height="3" fill={accent} rx="1" />
        <rect x="18" y="15" width="19" height="0.8" fill={HAIR} />
        <Lines x={18} y={19} w={19} count={4} gap={4.2} />
        <rect x="25" y="42" width="12" height="2.2" fill={accent} rx="1" />
      </svg>
    );
  }

  // 6 — Personal: the accent band header, whatever colour has been chosen.
  return (
    <svg {...common}>
      {paper}
      <rect x="0" y="0" width="40" height="14" fill={accent} rx="2" />
      <rect x="0" y="11" width="40" height="3" fill={accent} />
      <rect x="4" y="4.5" width="14" height="2.2" fill="#fff" opacity="0.95" rx="1" />
      <rect x="4" y="8.2" width="9" height="1.1" fill="#fff" opacity="0.5" rx="0.55" />
      <rect x="29" y="5" width="7" height="1.8" fill="#fff" opacity="0.9" rx="0.9" />
      <rect x="4" y="19" width="10" height="1.6" fill={INK} rx="0.8" />
      <rect x="26" y="19" width="10" height="1.3" fill={MUTE} rx="0.65" />
      <rect x="4" y="25" width="32" height="0.8" fill={HAIR} />
      <Lines x={4} y={29} w={32} count={4} gap={4} />
      <rect x="24" y="46" width="12" height="2.2" fill={accent} rx="1" />
    </svg>
  );
}
