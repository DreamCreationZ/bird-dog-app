const API_VERSION = "v1";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function baseUrl() {
  const raw = required("SUPABASE_URL");
  return raw.replace(/\/$/, "");
}

function serviceKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string>;
  body?: unknown;
  prefer?: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 408
    || status === 425
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

function isPgrstSchemaCacheError(text: string) {
  const raw = String(text || "");
  if (!raw) return false;
  if (/PGRST002/i.test(raw)) return true;
  return /schema cache/i.test(raw);
}

export async function supabaseRequest(path: string, options: RequestOptions = {}) {
  const method = options.method || "GET";
  const url = new URL(`${baseUrl()}/rest/${API_VERSION}/${path}`);
  const timeoutMs = Number.parseInt(process.env.SUPABASE_REQUEST_TIMEOUT_MS || "12000", 10);
  const maxRetries = Math.max(
    0,
    Number.parseInt(process.env.SUPABASE_REQUEST_MAX_RETRIES || "4", 10) || 0
  );

  if (options.query) {
    Object.entries(options.query).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
  }

  const headers: Record<string, string> = {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    "Content-Type": "application/json"
  };

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number.isFinite(timeoutMs) ? timeoutMs : 12000
    );

    try {
      const res = await fetch(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        cache: "no-store",
        signal: controller.signal
      });

      if (!res.ok) {
        const text = await res.text();
        const statusRetryable = isRetryableStatus(res.status);
        const schemaCacheRetryable = res.status === 503 && isPgrstSchemaCacheError(text);
        if (attempt < maxRetries && (statusRetryable || schemaCacheRetryable)) {
          await wait(Math.min(250 * (attempt + 1), 1200));
          continue;
        }
        throw new Error(`Supabase request failed (${res.status}): ${text}`);
      }

      if (res.status === 204) return null;
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (error) {
      const abortErr = error instanceof Error && error.name === "AbortError";
      const isNetworkErr = error instanceof Error
        && /fetch failed|network|ENOTFOUND|ECONNRESET|ETIMEDOUT|socket/i.test(error.message);
      const canRetryWrite = method === "GET" || method === "DELETE";
      const retryableThrown = abortErr || isNetworkErr;
      if (attempt < maxRetries && retryableThrown && canRetryWrite) {
        await wait(Math.min(250 * (attempt + 1), 1200));
        continue;
      }
      if (abortErr) {
        lastError = new Error(`Supabase request timed out after ${timeoutMs}ms`);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Supabase request failed");
}
