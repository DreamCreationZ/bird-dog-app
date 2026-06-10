import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const API_VERSION = "v1";

let envLoaded = false;

function stripQuotes(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = stripQuotes(trimmed.slice(idx + 1).trim());
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function ensureEnvLoaded() {
  if (envLoaded) return;
  const cwd = process.cwd();
  loadEnvFile(path.join(cwd, ".env.local"));
  loadEnvFile(path.join(cwd, ".env"));
  envLoaded = true;
}

function required(name) {
  ensureEnvLoaded();
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function baseUrl() {
  return required("SUPABASE_URL").replace(/\/$/, "");
}

function serviceKey() {
  return required("SUPABASE_SERVICE_ROLE_KEY");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 408
    || status === 425
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504;
}

function isPgrstSchemaCacheError(text) {
  const raw = String(text || "");
  if (!raw) return false;
  if (/PGRST002/i.test(raw)) return true;
  return /schema cache/i.test(raw);
}

export async function supabaseRequest(pathname, options = {}) {
  const method = options.method || "GET";
  const url = new URL(`${baseUrl()}/rest/${API_VERSION}/${pathname}`);
  const timeoutMs = Number.parseInt(process.env.SUPABASE_REQUEST_TIMEOUT_MS || "12000", 10);
  const maxRetries = Math.max(0, Number.parseInt(process.env.SUPABASE_REQUEST_MAX_RETRIES || "4", 10) || 0);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, value);
    }
  }

  const headers = {
    apikey: serviceKey(),
    Authorization: `Bearer ${serviceKey()}`,
    "Content-Type": "application/json"
  };

  if (options.prefer) {
    headers.Prefer = options.prefer;
  }

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) ? timeoutMs : 12000);
    try {
      const response = await fetch(url.toString(), {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text();
        const statusRetryable = isRetryableStatus(response.status);
        const schemaCacheRetryable = response.status === 503 && isPgrstSchemaCacheError(text);
        if (attempt < maxRetries && (statusRetryable || schemaCacheRetryable)) {
          await wait(Math.min(250 * (attempt + 1), 1200));
          continue;
        }
        throw new Error(`Supabase ${method} ${pathname} failed (${response.status}): ${text}`);
      }

      if (response.status === 204) return null;

      const payload = await response.text();
      if (!payload || !payload.trim()) {
        return null;
      }

      try {
        return JSON.parse(payload);
      } catch {
        throw new Error(`Supabase ${method} ${pathname} returned invalid JSON payload.`);
      }
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
        lastError = new Error(`Supabase ${method} ${pathname} timed out after ${timeoutMs}ms`);
      } else {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
      break;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error(`Supabase ${method} ${pathname} failed`);
}
