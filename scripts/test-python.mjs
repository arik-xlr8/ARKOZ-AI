import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
const win = process.platform === "win32";
const python = existsSync(win ? ".venv/Scripts/python.exe" : ".venv/bin/python")
  ? win
    ? ".venv/Scripts/python.exe"
    : ".venv/bin/python"
  : "python";
const result = spawnSync(
  python,
  ["-m", "unittest", "discover", "-s", "forecast-service", "-p", "test_*.py"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
