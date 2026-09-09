import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const base = process.env.E2E_URL ?? "http://localhost:4200";
let authToken = "";
async function authenticate() {
  const response = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD ?? "admin123" }),
  });
  assert.ok(response.ok, `login: ${response.status}`);
  authToken = (await response.json()).token;
  assert.ok(authToken);
}
async function api(path, body, method = "POST") {
  const r = await fetch(
    base + "/api" + path,
    body === undefined
      ? { headers: { "X-Arkoz-Session": authToken } }
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-Arkoz-Session": authToken,
          },
          body: JSON.stringify(body),
        },
  );
  assert.ok(r.ok, `${path}: ${r.status}`);
  return r.json();
}
await authenticate();
const autonomous = await api("/simulation/activate", {
  mode: "autonomous",
  seed: 20260908,
});
assert.equal(autonomous.running, true);
assert.equal(autonomous.mode, "autonomous");
await api("/simulation/pause", { paused: true });
const health = await api("/health");
assert.equal(health.forecast.status, "ok");
const initial = await api("/dashboard");
assert.equal(initial.online, 10);
assert.ok(initial.plantHealth >= 90);
assert.equal(
  initial.machines.find((m) => m.id === "kiln-main-motor").riskLevel,
  "LOW",
);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
page.setDefaultTimeout(90000);
const errors = [];
const liveProviders = [];
page.on("response", async (response) => {
  if (
    response.url().endsWith("/analysis") ||
    response.url().endsWith("/copilot/chat")
  ) {
    try {
      liveProviders.push((await response.json()).provider);
    } catch {}
  }
});
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base);
  assert.equal(await page.title(), "ARKOZ AI | Fabrika Analitiği");
  await page.locator(".login-card").waitFor();
  assert.equal(await page.locator(".login-lock .fa-lock").count(), 1);
  await page.getByLabel("Şifre").fill("yanlis-sifre");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Şifre hatalı" }).waitFor();
  await page.getByLabel("Şifre").fill(process.env.APP_PASSWORD ?? "admin123");
  await page.getByRole("button", { name: "Giriş yap", exact: true }).click();
  const loader = page.locator(".app-loader");
  await loader.waitFor();
  const progress = page.getByRole("progressbar", {
    name: "Sistem yükleme ilerlemesi",
  });
  await progress.waitFor();
  assert.ok(Number(await progress.getAttribute("aria-valuenow")) >= 0);
  assert.match(
    (await page.locator(".brand").innerText()).replace(/\s+/g, " "),
    /ARKOZ AI/,
  );
  await loader.waitFor({ state: "hidden" });
  const brandLogo = page.locator(".brand-logo");
  await brandLogo.waitFor();
  assert.equal(await brandLogo.getAttribute("src"), "/branding/arkoz_logo.PNG");
  assert.ok(await brandLogo.evaluate((image) => image.complete && image.naturalWidth > 0));
  assert.equal(
    await page.locator('link[rel="icon"]').getAttribute("href"),
    "/branding/arkoz-favicon.png?v=2",
  );
  await page
    .getByRole("heading", { name: "Fabrika genel durumu", exact: true })
    .waitFor();
  await page.getByText("Ağrı Çimento Fabrikası", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Otonom fabrika", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".calendar-day.current").waitFor();
  assert.equal((await page.locator(".calendar-month").innerText()).trim(), "EYLÜL");
  assert.equal((await page.locator(".calendar-year").innerText()).trim(), "2026");
  assert.match(await page.locator(".calendar-day.current").innerText(), /8$/);
  const calendarStyle = await page.evaluate(() => ({
    pastOpacity: Number(
      getComputedStyle(document.querySelector(".calendar-day.past")).opacity,
    ),
    futureOpacity: Number(
      getComputedStyle(document.querySelector(".calendar-day.future")).opacity,
    ),
    transition: getComputedStyle(
      document.querySelector(".calendar-track"),
    ).transitionDuration,
  }));
  assert.ok(calendarStyle.pastOpacity < calendarStyle.futureOpacity);
  assert.equal(calendarStyle.transition, "0.62s");
  await page
    .getByRole("button", { name: "Fırın Ana Motoru Pişirme Hattı" })
    .waitFor();
  await mkdir("docs/screenshots", { recursive: true });
  await page.screenshot({
    path: "docs/screenshots/dashboard.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Demo / test" }).click();
  await page.getByRole("button", { name: "Testi başlat" }).click();
  await page.waitForTimeout(3500);
  assert.ok(
    (await api("/dashboard")).simulation.step > 0,
    "Scenario advances automatically",
  );
  await page.getByRole("button", { name: "Duraklat", exact: true }).click();
  await api("/simulation/pause", { paused: true });
  const progressed = (await api("/dashboard")).simulation.step;
  await api("/simulation/step", { steps: Math.max(1, 16 - progressed) });
  await page.locator(".top-refresh").click();
  await page
    .getByRole("status")
    .filter({ hasText: "itibarıyla yenilendi" })
    .waitFor();
  const d = await api("/dashboard");
  const motor = d.machines.find((m) => m.id === "kiln-main-motor");
  assert.ok(
    motor.riskLevel === "HIGH" || motor.riskLevel === "CRITICAL",
    `Expected high or critical motor risk, got ${motor.riskLevel}`,
  );
  assert.ok(
    motor.risk.signals.find((s) => s.metric === "vibration").current > 5.5,
  );
  await page
    .getByRole("button", { name: "Fırın Ana Motoru Pişirme Hattı" })
    .click();
  await page
    .getByRole("heading", { name: "Yapay zekâ değerlendirmesi", exact: false })
    .waitFor();
  await page
    .getByRole("button", { name: "Bakım görevi oluştur", exact: true })
    .waitFor();
  assert.equal(await page.locator("sensor-chart").count(), 2);
  assert.ok(await page.locator("sensor-chart path").first().getAttribute("d"));
  await page.screenshot({
    path: "docs/screenshots/machine-detail.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Bakım görevi oluştur", exact: true })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Bakım görevi oluşturuldu" })
    .waitFor();
  await page
    .getByRole("button", { name: "Bakım sayfasına git", exact: false })
    .click();
  await page
    .getByRole("heading", { name: "Bakım görevleri", exact: true })
    .waitFor();
  const status = page.getByRole("combobox", { name: /Görev durumu:/ }).first();
  await status.selectOption("IN_PROGRESS");
  await page.waitForTimeout(500);
  assert.ok(
    (await api("/maintenance")).tasks.some((t) => t.status === "IN_PROGRESS"),
  );
  await page
    .locator("nav")
    .getByRole("button", { name: /Alarmlar/ })
    .click();
  await page
    .getByRole("button", { name: "Görüldü olarak işaretle", exact: true })
    .first()
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Alarm görüldü olarak işaretlendi" })
    .waitFor();
  assert.ok((await api("/alerts")).some((a) => a.status === "ACKNOWLEDGED"));
  await page
    .locator("nav")
    .getByRole("button", { name: "Tahminler", exact: false })
    .click();
  await page.locator("sensor-chart").waitFor();
  await page.getByRole("combobox").nth(3).selectOption({ label: "24 saat" });
  await page.waitForTimeout(700);
  const forecast = await api(
    "/machines/kiln-main-motor/forecast?metric=vibration&horizon=96",
  );
  assert.equal(forecast.forecast.length, 96);
  assert.equal(forecast.model, health.forecast.provider);
  await page
    .locator("nav")
    .getByRole("button", { name: "Yapay Zekâ Asistanı", exact: false })
    .click();
  await page
    .getByRole("textbox", { name: "Fabrika Asistanına sor" })
    .fill("Fırın Ana Motoru neden yüksek riskli?");
  await page.getByRole("button", { name: "Gönder", exact: false }).click();
  await page.locator(".message:not(.user)").waitFor();
  assert.match(
    await page.locator(".message:not(.user)").innerText(),
    /titreşim/i,
  );
  assert.match(await page.locator(".message:not(.user)").innerText(), /5,94/);
  await page.screenshot({
    path: "docs/screenshots/copilot.png",
    fullPage: true,
  });
  await page
    .locator("nav")
    .getByRole("button", { name: "Ayarlar", exact: false })
    .click();
  await page.getByRole("heading", { name: "Demo ayarları" }).waitFor();
  assert.match(await page.locator("main").innerText(), /SİMÜLASYON AYARLARI/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator("nav")
    .getByRole("button", { name: "Genel Bakış", exact: false })
    .click();
  await page.screenshot({
    path: "docs/screenshots/mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    "No page-wide mobile overflow",
  );
  await api("/simulation/step", { steps: 96 });
  assert.equal((await api("/dashboard")).simulation.step, 32);
  await api("/simulation/step", { steps: 1 });
  assert.equal(
    (await api("/dashboard")).simulation.step,
    32,
    "Scenario must stop at its configured limit",
  );
  await api("/simulation/activate", {
    mode: "autonomous",
    seed: 20260908,
  });
  await api("/simulation/pause", { paused: true });
  await api("/simulation/step", { steps: 96 });
  await api("/simulation/step", { steps: 96 });
  const reports = await api("/reports");
  assert.equal(reports.daily.length, 2);
  assert.ok(reports.events.length > 0);
  assert.ok(reports.daily.some((report) => report.criticalAssets.length > 0));
  assert.ok(
    reports.daily.every((report) =>
      report.forecastModels.includes("timesfm-2.5"),
    ),
  );
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.getByRole("button", { name: "Otonom fabrika" }).click();
  await page
    .locator("nav")
    .getByRole("button", { name: "Günlük Analizler", exact: false })
    .click();
  await page.getByRole("heading", { name: "Günlük Analizler" }).waitFor();
  await page
    .getByText("Sonraki gün görünümü", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.locator(".daily-report-card").count(), 2);
  await page.screenshot({
    path: "docs/screenshots/daily-reports.png",
    fullPage: true,
  });
  assert.deepEqual(
    (await page.locator(".step-actions button").allTextContents()).map((text) =>
      text.trim(),
    ),
    ["+1 saat", "+1 gün"],
    "Hour and day controls stay in one button group",
  );
  const resetResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/simulation/reset") && response.ok(),
  );
  await page.locator(".reset-button").click();
  await resetResponse;
  await page
    .getByRole("status")
    .filter({ hasText: "Simülasyon başa alındı" })
    .waitFor();
  const resetState = (await api("/dashboard")).simulation;
  assert.equal(resetState.mode, "autonomous");
  assert.equal(resetState.running, false);
  assert.equal(resetState.step, 0);
  assert.equal(resetState.day, 1);
  assert.equal((await api("/reports")).daily.length, 0);
  assert.equal((await api("/alerts")).filter((alert) => alert.status !== "RESOLVED").length, 0);
  assert.equal((await api("/maintenance")).tasks.length, 0);
  assert.deepEqual(errors, []);
  const profileToggle = page.locator(".profile-toggle");
  await profileToggle.click();
  const logoutButton = page.getByRole("menuitem", { name: "Çıkış Yap" });
  await logoutButton.waitFor();
  assert.equal(await profileToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await logoutButton.locator(".fa-right-from-bracket").count(), 1);
  await logoutButton.click();
  await page.locator(".login-card").waitFor();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("arkoz-session")),
    null,
  );
  if (process.env.REQUIRE_GEMINI === "1") {
    assert.ok(liveProviders.length >= 2);
    assert.ok(
      liveProviders.every((provider) => provider === "gemini"),
      "Assessment and copilot must use live Gemini",
    );
    assert.ok(
      reports.daily.every((report) => report.provider === "gemini"),
      "Daily reports must use live Gemini",
    );
  }
  console.log(
    "PASS: browser workflow, Python forecasting, risk escalation, task lifecycle, alert acknowledgment, grounded copilot, settings and mobile layout.",
  );
} finally {
  await api("/simulation/reset", {
    mode: "autonomous",
    seed: 20260908,
  });
  await browser.close();
}
