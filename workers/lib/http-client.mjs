const defaultUserAgents = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
];

let proxyIndex = 0;
let uaIndex = 0;

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

export async function fetchTournamentHtml(company, hint) {
  const target = targetFromHint(company, hint);
  const template = nextProxyTemplate();
  const url = template ? template.replace("{url}", encodeURIComponent(target)) : target;

  const response = await fetch(url, {
    headers: {
      "User-Agent": nextUserAgent(),
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`Scrape fetch failed (${response.status}) for ${target}`);
  }

  return {
    target,
    html: await response.text()
  };
}
