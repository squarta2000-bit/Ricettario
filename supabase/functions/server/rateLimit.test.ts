import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasImportCapacity, DAILY_IMPORT_LIMIT } from "./rateLimit.ts";

Deno.test("allows imports below the daily limit", () => {
  assertEquals(hasImportCapacity(0), true);
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT - 1), true);
});

Deno.test("blocks imports at or above the daily limit", () => {
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT), false);
  assertEquals(hasImportCapacity(DAILY_IMPORT_LIMIT + 5), false);
});
