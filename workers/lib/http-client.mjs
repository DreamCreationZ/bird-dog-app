const defaultUserAgents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
];

let proxyIndex = 0;
let uaIndex = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextUserAgent() {
  const custom = process.env.SCRAPER_USER_AGENTS
    ? process.env.SCRAPER_USER_AGENTS.split("||").map((item) => item.trim()).filter(Boolean)
    : defaultUserAgents;
  const list = custom.length ? custom : defaultUserAgents;
  const value = list[uaIndex % list.length];
  uaIndex += 1;
  return value;
}

function nextProxyTemplate() {
  const raw = process.env.RESIDENTIAL_PROXY_TEMPLATE_URLS || "";
  const list = raw.split(",").map((item) => item.trim()).filter(Boolean);
  if (!list.length) return null;
  const template = list[proxyIndex % list.length];
  proxyIndex += 1;
  return template;
}

function targetFromHint(company, hint) {
  if (/^https?:\/\//i.test(hint)) return hint;
  const encoded = encodeURIComponent(hint);
  if (company === "PG") {
    return `https://www.perfectgame.org/search.aspx?search=${encoded}`;
  }
  return `https://www.prepbaseballreport.com/search?query=${encoded}`;
}

function maybeBlocked(status, body) {
  if (status === 403 || status === 429 || status === 503) return true;
  const low = body.toLowerCase();
  return low.includes("captcha") || low.includes("access denied") || low.includes("temporarily unavailable");
}

export async function fetchTournamentHtml(company, hint) {
  const target = targetFromHint(company, hint);
  const maxAttempts = Number(process.env.SCRAPER_MAX_ATTEMPTS || 5);

  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const template = nextProxyTemplate();
    const url = template ? template.replace("{url}", encodeURIComponent(target)) : target;

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": nextUserAgent(),
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cache-Control": "no-cache"
        }
      });

      const html = await response.text();

      if (!response.ok || maybeBlocked(response.status, html)) {
        throw new Error(`Blocked or bad response (${response.status})`);
      }

      return {
        target,
        html,
        viaProxy: Boolean(template),
        attempt
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const jitter = Math.floor(Math.random() * 350);
      const waitMs = Math.min(9000, 500 * 2 ** (attempt - 1) + jitter);
      await sleep(waitMs);
    }
  }

  throw new Error(`Scrape fetch failed for ${target}: ${lastError?.message || "unknown error"}`);
}
