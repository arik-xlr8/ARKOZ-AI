# Validation record

Validated locally on Windows / Python 3.12 / project-local Node 24.15 and in Docker Linux containers on 2026-09-08.

- Angular production build and strict TypeScript backend build pass.
- 22 TypeScript tests pass: seed repeatability and target variation, sensor-visible wear, multi-stage process propagation, maintenance history/recovery, controlled-scenario isolation, multi-day risk progression, daily reports, debounced risk events, current-versus-future threshold semantics, risk/health calculations, strict Gemini validation, quota retry parsing, grounded copilot, forecast fallback and the 1024-point TimesFM transport limit.
- 4 Python tests pass: constant/trend prediction, validated endpoint input/timestamps and ordered batch forecasting.
- Chromium end-to-end test passes and covers autonomous controls, two day-end reports, spontaneous risk events, the 30-day/32-step API bounds, controlled risk increase, charts, maintenance lifecycle, alerts, live TimesFM forecasts, copilot, settings and mobile layout.
- `docker compose up --build -d` builds all images and starts the three services; forecast and backend health checks pass.
- Screenshots from the browser workflow are in `docs/screenshots/`.
- Turkish localization verified: all eight pages, equipment/sensor names, risk and task labels, simulated history, provider labels, date/number formatting and fallback explanations. Machine IDs and API status enums remain stable.

Live Gemini verification: after enabling the Google project API, Gemini 3.6 Flash successfully returned a schema-validated high-risk motor assessment, grounded copilot answer and a TimesFM-backed day-end report through the running local application. The integration uses the Interactions API; credentials remain in ignored local `.env`. Repeated final stress runs exhausted the project's current 20-request free-tier quota, so the final browser pass verified the named deterministic fallback. The client now prevents automatic three-second assessment calls, globally paces requests and avoids long waits when the provider reports a longer quota window.

TimesFM 2.5 was installed locally with the CPU PyTorch backend and its 925 MB checkpoint. Live health reported `timesfm-2.5`; a 96-point API forecast returned `model: timesfm-2.5` without fallback. Fleet inference uses the validated batch endpoint. A live day-end report combined TimesFM 24-hour summaries with a schema-validated Gemini response.

Known non-failing upstream warning: Starlette 1.6 warns that TestClient's httpx support is deprecated. Current pinned FastAPI/httpx tests pass.
