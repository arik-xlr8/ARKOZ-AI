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
const autonomous = await api("/simulation/reset", {
  mode: "autonomous",
  seed: 20260908,
});
assert.equal(autonomous.running, false);
assert.equal(autonomous.mode, "autonomous");
assert.equal(autonomous.step, 0);
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
  assert.ok(
    await brandLogo.evaluate(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  assert.equal(
    await page.locator('link[rel="icon"]').getAttribute("href"),
    "/branding/arkoz-favicon.png?v=2",
  );
  await page
    .getByRole("heading", { name: "Fabrika genel durumu", exact: true })
    .waitFor();
  const summaryRow = page.locator(".asset-summary-row").first();
  const summaryMachine = (await summaryRow.locator(".asset-link").innerText())
    .split("\n")[0]
    .trim();
  await summaryRow.locator("td").nth(2).click();
  await page
    .getByRole("heading", { name: summaryMachine, exact: true })
    .waitFor();
  await page
    .locator("nav")
    .getByRole("button", { name: "Genel Bakış", exact: false })
    .click();
  await page.locator(".asset-summary-row").first().waitFor();
  await page.getByText("Ağrı Çimento Fabrikası", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Otonom fabrika", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator(".calendar-day.current").waitFor();
  assert.equal(
    (await page.locator(".calendar-month").innerText()).trim(),
    "EYLÜL",
  );
  assert.equal(
    (await page.locator(".calendar-year").innerText()).trim(),
    "2026",
  );
  assert.match(await page.locator(".calendar-day.current").innerText(), /8$/);
  const calendarStyle = await page.evaluate(() => ({
    pastOpacity: Number(
      getComputedStyle(document.querySelector(".calendar-day.past")).opacity,
    ),
    futureOpacity: Number(
      getComputedStyle(document.querySelector(".calendar-day.future")).opacity,
    ),
    transition: getComputedStyle(document.querySelector(".calendar-track"))
      .transitionDuration,
  }));
  assert.ok(calendarStyle.pastOpacity < calendarStyle.futureOpacity);
  assert.equal(calendarStyle.transition, "0.62s");
  const factoryState = page.locator(".factory-run-state");
  assert.equal(await factoryState.getAttribute("data-state"), "ready");
  assert.equal(await factoryState.locator(".factory-gear").count(), 2);
  const timelineTimes = page.locator(".linear-time");
  assert.equal(await timelineTimes.count(), 11);
  assert.equal(await page.locator(".linear-time.past").count(), 5);
  assert.equal(await page.locator(".linear-time.future").count(), 5);
  assert.equal(await timelineTimes.nth(5).getAttribute("aria-current"), "time");
  assert.equal(await page.locator(".timeline-day b").innerText(), "1");
  assert.equal(await page.locator(".timeline-step b").innerText(), "0");
  await page
    .getByRole("button", { name: "Fatura Tahmini", exact: true })
    .click();
  await page.locator(".billing-kpi-grid").waitFor();
  const billingNav = page
    .locator("nav")
    .getByRole("button", { name: "Fatura Tahmini", exact: true });
  assert.equal(await billingNav.count(), 1);
  assert.ok((await billingNav.getAttribute("class")).includes("active"));
  const billingNavColor = await billingNav.evaluate(
    (element) => getComputedStyle(element).color,
  );
  assert.match(billingNavColor, /^rgb\((17|18), (97|100), (68|71)\)$/);
  assert.equal(await page.locator(".simulation-strip").count(), 0);
  assert.equal(await page.locator(".breadcrumb").count(), 0);
  assert.equal(await page.locator(".page-heading").count(), 0);
  assert.equal(await page.locator(".heading-actions").count(), 0);
  assert.equal(await page.locator(".demo-badge").innerText(), "SİMÜLE VERİ");
  assert.equal(await page.locator(".top-refresh").count(), 1);
  assert.equal(await page.locator(".plant-selector .live").count(), 1);
  assert.equal(await page.locator(".billing-kpi").count(), 4);
  assert.equal(await page.locator(".billing-category-card").count(), 4);
  assert.equal(await page.locator(".billing-bar-column").count(), 24);
  assert.equal(await page.locator(".billing-bar-column.forecast").count(), 6);
  const electricityBarLabel = await page
    .locator(".billing-bar-column")
    .first()
    .getAttribute("aria-label");
  const electricityKpi = await page.locator(".billing-kpi").first().innerText();
  const electricityBarColor = await page
    .locator(".billing-bar")
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page
    .locator(".billing-focus-tabs")
    .getByRole("button", { name: "Su", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".billing-panel-heading h2")
        ?.textContent?.trim() === "Su",
  );
  assert.equal(
    await page.locator(".billing-panel-heading h2").innerText(),
    "Su",
  );
  assert.notEqual(
    await page
      .locator(".billing-bar-column")
      .first()
      .getAttribute("aria-label"),
    electricityBarLabel,
  );
  const waterKpi = await page.locator(".billing-kpi").first().innerText();
  assert.notEqual(waterKpi, electricityKpi);
  assert.match(waterKpi, /Su/i);
  const rangeSeparator = await page
    .locator(".billing-range-separator")
    .evaluate((element) => ({
      color: getComputedStyle(element).color,
      paddingLeft: getComputedStyle(element).paddingLeft,
      paddingRight: getComputedStyle(element).paddingRight,
    }));
  assert.equal(rangeSeparator.color, "rgb(48, 50, 56)");
  assert.equal(rangeSeparator.paddingLeft, "7px");
  assert.equal(rangeSeparator.paddingRight, "7px");
  assert.notEqual(
    await page
      .locator(".billing-bar")
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundColor),
    electricityBarColor,
  );
  const forecastMarker = await page
    .locator(".billing-bar-column.forecast-start")
    .evaluate((element) => {
      const style = getComputedStyle(element, "::before");
      return { content: style.content, writingMode: style.writingMode };
    });
  assert.equal(forecastMarker.content, '"TAHMİN"');
  assert.equal(forecastMarker.writingMode, "horizontal-tb");
  const billingPoint = page.locator(".billing-bar-column").first();
  await billingPoint.hover();
  const billingTooltip = billingPoint.locator("chart-tooltip");
  await billingTooltip.waitFor();
  assert.match(await billingTooltip.innerText(), /Tutar/);
  assert.match(await billingTooltip.innerText(), /Tüketim/);
  const tooltipTypeScale = await billingTooltip.evaluate((element) => ({
    title: Number.parseFloat(
      getComputedStyle(element.querySelector(":scope > strong")).fontSize,
    ),
    amount: Number.parseFloat(
      getComputedStyle(
        element.querySelector(".tooltip-rows > span:first-child b"),
      ).fontSize,
    ),
  }));
  assert.ok(tooltipTypeScale.amount > tooltipTypeScale.title);
  assert.equal(await page.locator(".billing-period-card.forecast").count(), 6);
  assert.equal(await page.locator(".billing-period-card.history").count(), 0);
  assert.match(
    await page.locator(".billing-period-card.forecast").first().innerText(),
    /TAHMİN/,
  );
  await page.locator(".billing-history-toggle").click();
  await page.locator(".billing-period-card.history").first().waitFor();
  assert.equal(await page.locator(".billing-period-card.history").count(), 6);
  const historyBorder = await page
    .locator(".billing-period-card.history")
    .first()
    .evaluate((element) => getComputedStyle(element).borderColor);
  assert.match(historyBorder, /^rgba?\(224, 0, 42/);
  await page.locator(".billing-ai-panel").waitFor();
  assert.ok(
    (await page.locator(".billing-ai-summary").innerText()).length > 20,
  );
  assert.equal(
    await page.locator(".billing-provider-status > span").count(),
    2,
  );
  const scenarioPanel = page.locator(".billing-scenario-panel");
  await scenarioPanel.waitFor();
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-builder").count(),
    0,
  );
  await scenarioPanel.locator(".billing-scenario-toggle").click();
  await scenarioPanel.locator(".billing-scenario-builder").waitFor();
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-input-card").count(),
    4,
  );
  await page.getByLabel("Elektrik yüzde değişim oranı").fill("12.5");
  const fuelScenarioCard = scenarioPanel
    .locator(".billing-scenario-input-card")
    .filter({ hasText: "Doğal gaz ve yakıt" });
  await fuelScenarioCard.getByRole("button", { name: "İndirim" }).click();
  await page.getByLabel("Doğal gaz ve yakıt yüzde değişim oranı").fill("5");
  const scenarioResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/billing/scenario") &&
      response.status() === 200,
  );
  await scenarioPanel.getByRole("button", { name: "Tamam, hesapla" }).click();
  const scenarioResponse = await scenarioResponsePromise;
  const scenario = await scenarioResponse.json();
  assert.equal(scenario.categories.length, 4);
  assert.equal(
    scenario.categories.find((category) => category.id === "electricity")
      .adjustmentPercent,
    12.5,
  );
  assert.equal(
    scenario.categories.find((category) => category.id === "fuel")
      .adjustmentPercent,
    -5,
  );
  assert.equal(
    scenario.scenarioTotal,
    scenario.categories.reduce(
      (sum, category) => sum + category.scenarioTotal,
      0,
    ),
  );
  assert.equal(scenario.forecastMonths, 6);
  assert.equal(scenario.outlook.length, 6);
  assert.ok(
    scenario.categories.every((category) => category.points.length === 6),
  );
  await scenarioPanel.locator(".billing-scenario-results").waitFor();
  await page.mouse.move(0, 0);
  assert.equal(
    await scenarioPanel
      .getByRole("button", { name: "Tamam, hesapla" })
      .evaluate((element) => getComputedStyle(element).borderColor),
    "rgb(115, 95, 195)",
  );
  assert.equal(
    await scenarioPanel
      .locator(".billing-scenario-summary-grid article")
      .count(),
    3,
  );
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-chart-card").count(),
    5,
  );
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-chart-card.total").count(),
    1,
  );
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-month-group").count(),
    30,
  );
  assert.equal(
    await scenarioPanel.locator(".billing-scenario-bar-point").count(),
    60,
  );
  assert.ok(
    (await scenarioPanel.locator(".billing-scenario-ai > p").innerText())
      .length > 20,
  );
  const scenarioAiFontSizes = await scenarioPanel
    .locator(".billing-scenario-ai")
    .evaluate((element) => ({
      kicker: Number.parseFloat(
        getComputedStyle(element.querySelector(":scope > header small"))
          .fontSize,
      ),
      title: Number.parseFloat(
        getComputedStyle(element.querySelector(":scope > header h3")).fontSize,
      ),
      summary: Number.parseFloat(
        getComputedStyle(element.querySelector(":scope > p")).fontSize,
      ),
      heading: Number.parseFloat(
        getComputedStyle(element.querySelector("section h4")).fontSize,
      ),
      item: Number.parseFloat(
        getComputedStyle(element.querySelector("li")).fontSize,
      ),
      footer: Number.parseFloat(
        getComputedStyle(element.querySelector("footer")).fontSize,
      ),
    }));
  assert.deepEqual(scenarioAiFontSizes, {
    kicker: 11,
    title: 17,
    summary: 15.5,
    heading: 15,
    item: 14.5,
    footer: 13,
  });
  const scenarioPoint = scenarioPanel
    .locator(".billing-scenario-bar-point")
    .nth(1);
  await scenarioPoint.hover();
  await scenarioPoint.locator("chart-tooltip").waitFor();
  assert.match(
    await scenarioPoint.locator("chart-tooltip").innerText(),
    /Baz tahmine fark/,
  );
  const firstInvoice = await page
    .locator(".next-invoice-total strong")
    .innerText();
  await page.locator("#billing-seed").fill("424242");
  await page.getByRole("button", { name: "Modeli çalıştır" }).click();
  await page.getByRole("status").filter({ hasText: "424242 tohumu" }).waitFor();
  assert.notEqual(
    await page.locator(".next-invoice-total strong").innerText(),
    firstInvoice,
  );
  await page.goBack();
  await page.locator(".asset-summary-row").first().waitFor();
  assert.equal(decodeURIComponent(new URL(page.url()).hash), "#genel-bakış");
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
  const sensorPoint = page.locator("sensor-chart .sensor-chart-point").last();
  await sensorPoint.hover();
  const sensorTooltip = sensorPoint.locator("chart-tooltip");
  await sensorTooltip.waitFor();
  assert.match(await sensorTooltip.innerText(), /Değer/);
  assert.match(await sensorTooltip.innerText(), /Uyarı eşiği/);
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
  assert.equal(
    (await api("/alerts")).filter((alert) => alert.status !== "RESOLVED")
      .length,
    0,
  );
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
