/** Single header lookup. */
export function parsePgnHeader(pgn: string, key: string): string | null {
  const match = pgn.match(new RegExp(`\\[${key} "([^"]+)"\\]`));
  return match ? match[1] : null;
}

const HEADER_LINE = /^\[([A-Za-z0-9]+)\s+"([^"]*)"\]/gm;

/**
 * One pass over the PGN header block. Stops at the first blank line so the
 * movetext is never scanned — worth it when pulling several headers from
 * every game in a multi-thousand-game archive.
 */
export function parsePgnHeaders(pgn: string): Record<string, string> {
  if (!pgn) return {};

  const end = pgn.indexOf("\n\n");
  const block = end === -1 ? pgn : pgn.slice(0, end);

  const out: Record<string, string> = {};
  HEADER_LINE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADER_LINE.exec(block)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

export interface OpeningInfo {
  /** ECO code, e.g. "B90". */
  eco: string | null;
  /** Display name, e.g. "Sicilian Defense Najdorf Variation". */
  name: string | null;
  /** Lowercased normalized name — the substring-match target. */
  key: string;
  /** Grouping label, e.g. "Sicilian Defense". */
  family: string;
}

const UNKNOWN: OpeningInfo = {
  eco: null,
  name: null,
  key: "unknown",
  family: "Unknown",
};

/** Tokens like "6.Be3" or "2...Nc6" — the move suffix Chess.com appends. */
const MOVE_TOKEN = /^\d+\.{1,3}/;

/** The word that usually terminates an opening's family name. */
const FAMILY_MARKERS = new Set([
  "defense",
  "defence",
  "game",
  "opening",
  "gambit",
  "countergambit",
  "attack",
  "system",
  "variation",
]);

/** Lowercase, collapse anything non-alphanumeric to single spaces. */
export function normalizeOpeningPhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function nameFromEcoUrl(ecoUrl: string): string | null {
  let slug: string;
  try {
    slug = decodeURIComponent(ecoUrl.split("/").filter(Boolean).pop() ?? "");
  } catch {
    slug = ecoUrl.split("/").filter(Boolean).pop() ?? "";
  }
  if (!slug) return null;

  // Some slugs lead with the ECO code, some don't.
  slug = slug.replace(/^[A-E]\d{2}-/, "");

  const tokens = slug.split("-").filter(Boolean);
  const cut = tokens.findIndex((t) => MOVE_TOKEN.test(t));
  const words = cut === -1 ? tokens : tokens.slice(0, cut);

  const name = words.join(" ").trim();
  return name || null;
}

function familyFromName(name: string): string {
  const words = name.split(" ");
  const marker = words.findIndex((w) =>
    FAMILY_MARKERS.has(w.toLowerCase().replace(/[^a-z]/g, ""))
  );
  if (marker !== -1) return words.slice(0, marker + 1).join(" ");
  return words.slice(0, 2).join(" ");
}

/**
 * Derives opening identity from a game's PGN headers. Chess.com supplies
 * `[ECO "B90"]` and `[ECOUrl ".../B90-Sicilian-Defense-Najdorf-Variation-6.Be3"]`.
 */
export function parseOpening(headers: Record<string, string>): OpeningInfo {
  const eco = headers.ECO?.trim() || null;
  const ecoUrl = headers.ECOUrl?.trim() || null;

  const name = ecoUrl ? nameFromEcoUrl(ecoUrl) : null;

  if (!name) {
    // No usable URL. An ECO code alone still groups meaningfully.
    if (eco) {
      return { eco, name: null, key: eco.toLowerCase(), family: `ECO ${eco}` };
    }
    return UNKNOWN;
  }

  return {
    eco,
    name,
    key: normalizeOpeningPhrase(name),
    family: familyFromName(name),
  };
}
