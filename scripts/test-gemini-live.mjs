import assert from "node:assert/strict";
const base = "http://localhost:4200/api";
async function api(path, body) {
  const r = await fetch(
    base + path,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (!r.ok) throw Error(path + " HTTP " + r.status);
  return r.json();
}
try {
  await api("/simulation/activate", { scenarioId: "bearing" });
  await api("/simulation/pause", { paused: true });
  await api("/simulation/step", { steps: 16 });
  const started = Date.now();
  const a = await api("/machines/kiln-main-motor/analysis");
  console.log(
    JSON.stringify({
      test: "machine-assessment",
      provider: a.provider,
      summary: a.summary,
      causes: a.probableCauses.length,
      actions: a.recommendedActions.length,
      milliseconds: Date.now() - started,
      fallbackReason: a.fallbackReason,
    }),
  );
  assert.equal(a.provider, "gemini");
  const chat = await api("/copilot/chat", {
    message: "Fırın Ana Motoru neden yüksek riskli?",
  });
  console.log(
    JSON.stringify({
      test: "copilot",
      provider: chat.provider,
      answer: chat.answer,
      sources: chat.sources.length,
    }),
  );
  assert.equal(chat.provider, "gemini");
  assert.ok(chat.sources.some((s) => s.machineId === "kiln-main-motor"));
  console.log("LIVE GEMINI TESTS PASSED");
} finally {
  await api("/simulation/activate", { scenarioId: "normal" });
}
