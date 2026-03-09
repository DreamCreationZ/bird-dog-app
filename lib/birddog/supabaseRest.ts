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

export async function supabaseRequest(path: string, options: RequestOptions = {}) {
  const method = options.method || "GET";
  const url = new URL(`${baseUrl()}/rest/${API_VERSION}/${path}`);

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

  const res = await fetch(url.toString(), {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase request failed (${res.status}): ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}
