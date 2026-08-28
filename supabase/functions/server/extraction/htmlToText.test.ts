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

Deno.test("collapses whitespace", () => {
  const text = htmlToVisibleText("<p>Hello   \n\n  world</p>");
  assertEquals(text, "Hello world");
});

Deno.test("truncates very long input", () => {
  const text = htmlToVisibleText("<p>" + "a".repeat(50_000) + "</p>");
  assertEquals(text.length <= 20_000, true);
});
