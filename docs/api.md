# REST API

All Node endpoints use `/api`; request/response bodies are JSON. Invalid input returns 400, missing entities 404, conflicting actions 409. Unknown errors return a generic 500. Python validation returns 422.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | API, actual forecast provider, AI and storage status; never returns keys |
| GET | `/dashboard` | KPIs, sorted risks, simulation state and update timestamp |
| GET | `/machines` | All ten evaluated assets |
| GET | `/machines/:id` | Asset metadata, risk and signals |
| GET | `/machines/:id/sensors` | Configured sensors and historical readings |
| GET | `/machines/:id/forecast?metric=vibration&horizon=16` | Timestamped forecast, actual model and fallback reason |
| GET | `/machines/:id/analysis` | Validated structured assessment, provider and evidence timestamp |
| GET | `/alerts` | Current and resolved alert conditions |
| POST | `/alerts/:id/acknowledge` | Mark active alert acknowledged (URL-encode alert ID) |
| GET | `/maintenance` | Tasks and simulated historical maintenance records |
| GET | `/reports` | Stored day-end assessments and deterministic risk-transition events for the active run |
| GET | `/billing?seed=20260908` | Seeded 18-month utility and operating-cost history, six-month outlook and next-period interval |
| POST | `/maintenance` | `{ "machineId": "kiln-main-motor", "title": "Inspect bearing condition" }` |
| PATCH | `/maintenance/:id` | `{ "status": "IN_PROGRESS" }`; OPEN / IN_PROGRESS / COMPLETED |
| POST | `/copilot/chat` | `{ "message": "Which machines should I inspect today?", "machineId": "optional-id" }` |
| GET | `/simulation/scenarios` | Scenario options and state |
| POST | `/simulation/activate` | Autonomous: `{ "mode": "autonomous", "seed": 20260908 }`; controlled test: `{ "mode": "scenario", "scenarioId": "bearing" }` |
| POST | `/simulation/reset` | Stops and rewinds the selected mode to day 1, step 0. Accepts the same body as `/simulation/activate`; clears run reports, events, alerts and tasks. |
| POST | `/simulation/pause` | `{ "paused": true }` |
| POST | `/simulation/step` | `{ "steps": 4 }`; 1–96 samples per request (4 = one hour, 96 = one day). Requests are clamped at 32 scenario samples or 30 autonomous days. |
| GET | `/settings` | Read-only simulated limits, storage and provider configuration |

FastAPI: `GET /health`, `POST /forecast`, `POST /forecast/batch`, and generated `/docs`. The batch endpoint lets the API forecast the fleet in one TimesFM inference instead of queueing every sensor separately. During long runs the Express client sends the latest 1024 samples per series.

```json
{
  "machineId": "kiln-main-motor",
  "metric": "vibration",
  "timestamps": ["2026-09-08T00:00:00Z", "2026-09-08T00:15:00Z", "2026-09-08T00:30:00Z", "2026-09-08T00:45:00Z", "2026-09-08T01:00:00Z", "2026-09-08T01:15:00Z", "2026-09-08T01:30:00Z", "2026-09-08T01:45:00Z"],
  "values": [3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.0, 4.1],
  "horizon": 4
}
```

Forecast outputs include `machineId`, `metric`, `forecast: [{timestamp,value}]`, `model`, and optional `fallbackReason`. Confidence is intentionally absent.

`GET /reports` returns `daily` and `events`. Daily reports contain the deterministic plant health, ranked assets, actual forecast model names, future predicted threshold crossings and a schema-validated Gemini narrative (or named deterministic fallback). A sensor already above its threshold is represented as a current condition rather than a new future crossing. Event entries are created at 15-minute risk-level transitions; the LLM does not decide those transitions.

`GET /billing` creates a repeatable 48-month simulated context for electricity, natural gas/fuel, water, and raw-material/additive consumption and unit prices. Eight regular monthly series are sent as one batch to the configured Python forecast provider; the response exposes the latest 18 months and six forecast months. Category amounts are calculated from TimesFM-predicted consumption × TimesFM-predicted unit price, then Gemini receives the bounded numeric evidence to produce the Turkish summary, key drivers, and review actions. Both forecast and narrative responses name their actual provider and any fallback reason.
