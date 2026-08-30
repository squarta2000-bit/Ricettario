import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { htmlToVisibleText } from "./htmlToText.ts";

Deno.test("strips scripts, styles, and tags, keeping visible text", () => {
  const html = `
    <html><head><style>.a{color:red}</style><script>alert(1)</script></head>
    <body><nav>Home | About</nav><h1>Tomato Soup</h1><p>Chop the onion.</p><footer>© 2026</footer></body></html>
  `;
  const text = htmlToVisibleText(html);
  assertStringIncludes(text, "Tomato Soup");
  assertStringIncludes(text, "Chop the onion.");
  assertEquals(text.includes("alert(1)"), false);
  assertEquals(text.includes("color:red"), false);
  assertEquals(text.includes("Home | About"), false);
  assertEquals(text.includes("© 2026"), false);
});

Deno.test("keeps a semantic article header's recipe metadata, unlike site-wide nav/footer", () => {
  // Many recipe sites wrap the article title plus its time/difficulty meta
  // in a semantic <header> - only <nav>/<footer> are site-wide chrome safe
  // to discard outright.
  const html = `
    <body><nav>Home | About</nav>
    <header><h1>Lasagne</h1><span>40 minuti</span><span>Facile</span></header>
    <p>Chop the onion.</p><footer>© 2026</footer></body>
  `;
  const text = htmlToVisibleText(html);
  assertStringIncludes(text, "40 minuti");
  assertStringIncludes(text, "Facile");
});

Deno.test("keeps table rows on separate lines so labels stay aligned with their values", () => {
  const html = `
    <table><tbody>
      <tr><th>Preparazione</th><th>Cottura</th><th>Totale</th></tr>
      <tr><td>40 minuti</td><td>2 ore</td><td>2 ore e 40 minuti</td></tr>
    </tbody></table>
  `;
  const text = htmlToVisibleText(html);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  assertEquals(lines, ["Preparazione Cottura Totale", "40 minuti 2 ore 2 ore e 40 minuti"]);
});

Deno.test("collapses whitespace", () => {
  const text = htmlToVisibleText("<p>Hello   \n\n  world</p>");
  assertEquals(text, "Hello world");
});

Deno.test("truncates very long input", () => {
  const text = htmlToVisibleText("<p>" + "a".repeat(50_000) + "</p>");
  assertEquals(text.length <= 20_000, true);
});
