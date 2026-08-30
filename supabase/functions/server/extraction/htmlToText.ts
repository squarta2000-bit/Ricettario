// Placeholder for a structural line break, inserted before all other tags
// are stripped and all other whitespace (including incidental newlines in
// the source markup) is collapsed to single spaces - keeping only the
// breaks we deliberately inserted. Built via fromCharCode (rather than a
// literal character) so this file stays plain ASCII.
const BREAK = String.fromCharCode(0xe000);

export function htmlToVisibleText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    // Break at row/paragraph/list/heading boundaries so a table like
    // "<tr><th>Preparazione</th><th>Cottura</th></tr><tr><td>40
    // minuti</td><td>2 ore</td></tr>" becomes two aligned lines
    // ("Preparazione Cottura" / "40 minuti 2 ore") instead of one run-on
    // line where the LLM can no longer tell which label goes with which
    // value.
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, BREAK);
  const withoutTags = withoutNoise.replace(/<[^>]+>/g, " ");
  return withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(new RegExp(`( ?${BREAK} ?)+`, "g"), "\n")
    .trim()
    .slice(0, 20_000);
}
