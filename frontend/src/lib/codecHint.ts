/**
 * Codec / container detection from torrent release titles.
 *
 * Why this exists: most P2P search results are MKV/HEVC releases that
 * don't play in <video> elements. We can't transcode in-browser, so the
 * next-best move is to (a) flag releases that almost certainly won't
 * play, (b) prefer ones that almost certainly will, (c) when playback
 * fails with MEDIA_ERR_SRC_NOT_SUPPORTED, point the user at the actual
 * codec issue instead of a generic "max retries" message.
 *
 * The heuristic is title-substring based — Knaben/apibay/etc. don't
 * give us structured codec metadata. False negatives ("unknown") are
 * fine; false positives ("playable" when it isn't) cost more, so the
 * matching is conservative and leans on common scene-release tags.
 */

export type Playability = "good" | "warn" | "unknown";

export interface CodecHint {
  /** The detected video codec, if any (e.g. "H.264", "H.265", "AV1"). */
  codec: string | null;
  /** The detected container, if any (e.g. "MKV", "MP4", "WEBM"). */
  container: string | null;
  /** Whether bit depth is the high-end variant that breaks browsers. */
  is10Bit: boolean;
  /** Short label suitable for a badge (e.g. "X264", "X265 10-BIT", "AV1"). */
  label: string | null;
  /** Coarse playability bucket for UI styling and sorting. */
  severity: Playability;
}

const NORMALISED_CODEC_TAGS: Array<{ pattern: RegExp; codec: string; severity: Playability }> = [
  // h.264 / x264 / avc — broad browser support, our preferred case.
  { pattern: /\b(?:x ?264|h ?264|avc)\b/i, codec: "H.264", severity: "good" },
  // h.265 / x265 / hevc — Safari/some Chrome only; Firefox never.
  { pattern: /\b(?:x ?265|h ?265|hevc)\b/i, codec: "H.265", severity: "warn" },
  // av1 — limited but improving support.
  { pattern: /\bav1\b/i, codec: "AV1", severity: "warn" },
  // vp9 — Chrome/Firefox yes, Safari sometimes.
  { pattern: /\bvp9\b/i, codec: "VP9", severity: "good" },
  // xvid / divx — old MPEG-4 ASP, no modern browser plays it.
  { pattern: /\b(?:xvid|divx)\b/i, codec: "XviD", severity: "warn" },
];

const CONTAINER_TAGS: Array<{ pattern: RegExp; container: string; severity: Playability }> = [
  // MP4 plays everywhere.
  { pattern: /\.mp4\b|\bmp4\b/i, container: "MP4", severity: "good" },
  // WEBM plays in Chrome/Firefox.
  { pattern: /\.webm\b|\bwebm\b/i, container: "WEBM", severity: "good" },
  // MKV — Firefox never plays it; Chrome only with H.264 inside.
  { pattern: /\.mkv\b|\bmkv\b/i, container: "MKV", severity: "warn" },
  // AVI — old, doesn't play.
  { pattern: /\.avi\b|\bavi\b/i, container: "AVI", severity: "warn" },
];

const TEN_BIT_RE = /\b10[\s.-]?bit\b/i;

/**
 * Combine codec, container, and bit-depth into a single playability bucket.
 * Conservative: any "warn" signal makes the whole thing "warn".
 */
function combineSeverity(parts: Playability[]): Playability {
  if (parts.includes("warn")) return "warn";
  if (parts.includes("good")) return "good";
  return "unknown";
}

/**
 * Parse a release title and return a structured codec hint.
 */
export function detectCodec(title: string): CodecHint {
  if (!title) {
    return {
      codec: null,
      container: null,
      is10Bit: false,
      label: null,
      severity: "unknown",
    };
  }

  let codec: string | null = null;
  let codecSeverity: Playability = "unknown";
  for (const entry of NORMALISED_CODEC_TAGS) {
    if (entry.pattern.test(title)) {
      codec = entry.codec;
      codecSeverity = entry.severity;
      break;
    }
  }

  let container: string | null = null;
  let containerSeverity: Playability = "unknown";
  for (const entry of CONTAINER_TAGS) {
    if (entry.pattern.test(title)) {
      container = entry.container;
      containerSeverity = entry.severity;
      break;
    }
  }

  const is10Bit = TEN_BIT_RE.test(title);
  // 10-bit HEVC is the canonical "won't play" combo even when the
  // codec alone might have been graded "good" elsewhere.
  const tenBitSeverity: Playability = is10Bit ? "warn" : "unknown";

  const severity = combineSeverity([codecSeverity, containerSeverity, tenBitSeverity]);

  // Build a compact badge label: prefer codec, optionally annotate 10-bit.
  let label: string | null = null;
  if (codec) {
    label = codec.replace("H.", "H");
    if (is10Bit) label += " 10-BIT";
  } else if (container) {
    label = container;
  } else if (is10Bit) {
    label = "10-BIT";
  }

  return { codec, container, is10Bit, label, severity };
}

/**
 * Sort comparator that bubbles "good" results above "warn" / "unknown",
 * preserving the original (seeder-based) order within each bucket.
 *
 * Use as `[...results].sort(byPlayability)` — pure function, no input
 * mutation, stable when severities tie.
 */
export function byPlayability<T extends { title: string }>(a: T, b: T): number {
  const order: Record<Playability, number> = { good: 0, unknown: 1, warn: 2 };
  return order[detectCodec(a.title).severity] - order[detectCodec(b.title).severity];
}

/**
 * Human-friendly explanation for the playback-failed overlay when the
 * underlying error is MEDIA_ERR_SRC_NOT_SUPPORTED (codec/container).
 *
 * Returns null when we can't detect a culprit — caller should fall
 * back to the generic message.
 */
export function explainPlaybackFailure(title: string): string | null {
  const hint = detectCodec(title);
  if (hint.severity !== "warn") return null;

  const reasons: string[] = [];
  if (hint.codec === "H.265") reasons.push("HEVC/H.265 (limited browser support)");
  if (hint.codec === "AV1") reasons.push("AV1 (limited browser support)");
  if (hint.codec === "XviD") reasons.push("XviD/DivX (no browser support)");
  if (hint.container === "MKV") reasons.push("MKV container (not supported in Firefox)");
  if (hint.container === "AVI") reasons.push("AVI container (no browser support)");
  if (hint.is10Bit) reasons.push("10-bit colour depth");

  if (reasons.length === 0) return null;
  return `This release uses ${reasons.join(" + ")}. Try an X264 / MP4 release instead, or open it in Chrome / Safari.`;
}
