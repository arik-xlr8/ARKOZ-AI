import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");
const win = process.platform === "win32";
const python = existsSync(win ? ".venv/Scripts/python.exe" : ".venv/bin/python")
  ? win
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python"
  : "python";
const jobs = [
  spawn(
    python,
    [
      "-m",
      "uvicorn",
      "app:app",
      "--app-dir",
      "forecast-service",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--reload",
    ],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "watch", "backend/src/index.ts"],
    { stdio: "inherit" },
  ),
  spawn(
    process.execPath,
    [
      "../node_modules/@angular/cli/bin/ng.js",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "4200",
      "--proxy-config",
      "proxy.json",
      "--poll",
      "1000",
    ],
    {
      cwd: "frontend",
      stdio: "inherit",
      env: { ...process.env, PORT: "4200" },
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of jobs) {
    if (win && child.pid)
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    else child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 500);
}
for (const child of jobs) {
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping && code) stop(code);
  });
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
