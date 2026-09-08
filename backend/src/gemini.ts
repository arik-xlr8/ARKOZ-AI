import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

const minimumIntervalMs = Math.max(
  0,
  Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 3_100),
);
const maximumRetryWaitMs = Math.max(
  0,
  Number(process.env.GEMINI_MAX_RETRY_WAIT_MS ?? 5_000),
);
let requestQueue: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const forbiddenAdvisoryClaims = [
  /\b(?:kesin(?:likle| olarak)?|mutlaka|kaçınılmaz)\b.{0,80}\b(?:arız|bozul|hasar|fail)/iu,
  /\b(?:arız|bozul|hasar|fail)\S*.{0,80}\b(?:kesin(?:likle| olarak)?|mutlaka|kaçınılmaz)\b/iu,
  /\b(?:güvenlidir|emniyetlidir|güvenli sınır|emniyetli sınır|güvenli çalışma|üretici(?: tarafından)? onaylı|sertifikalı güvenli|certified safe|safe operating)\b/iu,
  /\b(?:will|certain(?:ly)?|guaranteed to)\s+fail\b/iu,
];

export const isAllowedAdvisoryText = (value: string) =>
  forbiddenAdvisoryClaims.every((pattern) => !pattern.test(value));

export function geminiRateLimitDelay(error: unknown): number | null {
  const record = error as { status?: number; message?: string };
  const message = record?.message ?? String(error);
  const rateLimited = record?.status === 429 || /(?:\b429\b|rate\s*limit|quota exceeded)/i.test(message);
  if (!rateLimited) return null;
  const retry = message.match(/retry in\s+([\d.]+)s/i);
  return retry ? Math.min(60_000, Math.ceil(Number(retry[1]) * 1_000) + 500) : 5_000;
}

function enqueueGeminiRequest<T>(request: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const initialWait = nextRequestAt - Date.now();
    if (initialWait > 0) await delay(initialWait);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const value = await request();
        nextRequestAt = Date.now() + minimumIntervalMs;
        return value;
      } catch (error) {
        nextRequestAt = Date.now() + minimumIntervalMs;
        const retryAfter = geminiRateLimitDelay(error);
        if (
          retryAfter === null ||
          retryAfter > maximumRetryWaitMs ||
          attempt === 1
        )
          throw error;
        await delay(Math.max(minimumIntervalMs, retryAfter));
      }
    }
    throw new Error("Gemini request retry exhausted");
  });
  requestQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Shared, bounded structured-output transport; numerical risk stays outside the LLM. */
export class GeminiJsonClient {
  private client: GoogleGenAI;
  constructor(key: string) {
    this.client = new GoogleGenAI({ apiKey: key });
  }
  async generate<T extends z.ZodType>(
    schema: T,
    instruction: string,
    context: unknown,
  ): Promise<z.infer<T>> {
    return enqueueGeminiRequest(async () => {
      const result = await this.client.interactions.create(
        {
          model: process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
          input: JSON.stringify(context),
          system_instruction: instruction,
          generation_config: { thinking_level: "low", max_output_tokens: 4096 },
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema: z.toJSONSchema(schema),
          },
          store: false,
          stream: false,
        },
        { timeout: 45000, maxRetries: 1, retry_codes: [] },
      );
      return schema.parse(JSON.parse(result.output_text ?? ""));
    });
  }
}
