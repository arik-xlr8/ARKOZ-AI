import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiRateLimitDelay } from "../src/gemini.js";

test("Gemini rate-limit delay follows the provider retry window", () => {
  assert.equal(
    geminiRateLimitDelay({
      status: 429,
      message: "Quota exceeded. Please retry in 9.25s.",
    }),
    9_750,
  );
  assert.equal(geminiRateLimitDelay(new Error("invalid JSON")), null);
});
