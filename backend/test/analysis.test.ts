import { test } from "node:test";
import assert from "node:assert/strict";
import { analysisSchema } from "../src/analysis.js";
const valid = {
  summary: "Elevated vibration requires inspection.",
  probableCauses: [
    {
      cause: "Possible misalignment",
      confidence: "low",
      reasoning: "Vibration increasing.",
    },
  ],
  recommendedActions: [
    { priority: 1, action: "Inspect alignment", reason: "Validate the trend." },
  ],
  urgency: "inspect_soon",
  operatorMessage: "Qualified personnel must validate.",
};
test("Gemini response validator accepts strict structured assessment", () =>
  assert.equal(analysisSchema.safeParse(valid).success, true));
test("reject malformed urgency, HTML, extra keys and unbounded confidence", () => {
  for (const change of [
    { urgency: "shut_down" },
    { summary: "<script>bad()</script>" },
    { html: "evil" },
    { summary: "Makine kesin olarak arızalanacak." },
    { operatorMessage: "Bu koşul güvenlidir ve üretici onaylıdır." },
    { probableCauses: [{ cause: "Wear", confidence: 0.99, reasoning: "x" }] },
    { recommendedActions: [] },
  ])
    assert.equal(
      analysisSchema.safeParse({ ...valid, ...change }).success,
      false,
    );
});
