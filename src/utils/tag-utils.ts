/**
 * Deduplicate tags in a comma-separated string (case-insensitive)
 * Segments that are part of weighted groups (containing "::") are preserved
 * as-is and never deduplicated, since a naive comma split cannot tell where
 * a weight group starts or ends.
 *
 * @param prompt - Prompt string with tags separated by commas
 * @returns Deduplicated prompt string
 */
function dedupeCommaSegments(text: string, seen: Set<string>): string[] {
  const deduped: string[] = [];

  for (const tag of text.split(",")) {
    const trimmed = tag.trim();
    if (!trimmed) continue;
    if (trimmed.includes("::")) {
      deduped.push(trimmed);
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      deduped.push(trimmed);
    }
  }

  return deduped;
}

export function deduplicateTags(prompt: string): string {
  if (!prompt) return prompt;

  // A single line keeps the historical join: a trailing comma is an empty
  // segment and is dropped. Newlines must stay, and a ", " (or ",") already
  // sitting at the end of a line is part of that line, not an empty segment.
  if (!prompt.includes("\n")) {
    return dedupeCommaSegments(prompt, new Set()).join(", ");
  }

  const seen = new Set<string>();
  return prompt
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => {
      const trailing = line.match(/,[ \t]*$/);
      const body = trailing ? line.slice(0, trailing.index) : line;
      const rebuilt = dedupeCommaSegments(body, seen).join(", ");
      return trailing ? rebuilt + trailing[0] : rebuilt;
    })
    .join("\n");
}
