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

export async function supabaseRequest(pathname, options = {}) {
  const method = options.method || "GET";
  const url = new URL(`${baseUrl()}/rest/${API_VERSION}/${pathname}`);

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

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase ${method} ${pathname} failed (${response.status}): ${text}`);
  }

  if (response.status === 204) return null;
  return response.json();
}
