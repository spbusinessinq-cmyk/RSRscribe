import { XMLParser } from "fast-xml-parser";

export type RawCandidate = {
  headline: string;
  url: string;
  summary: string;
  publishedAt: string;
  sourceHost: string;
  feedName: string;
  scope: string;
};

type FeedDef = {
  name: string;
  url: string;
  scope: string[];
};

const FEEDS: FeedDef[] = [
  {
    name: "BBC World",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    scope: ["GLOBAL", "CONFLICT"],
  },
  {
    name: "BBC Business",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    scope: ["GLOBAL", "ENERGY"],
  },
  {
    name: "Al Jazeera World",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    scope: ["GLOBAL", "CONFLICT"],
  },
  {
    name: "Reuters World",
    url: "https://feeds.reuters.com/Reuters/worldNews",
    scope: ["GLOBAL", "CONFLICT"],
  },
  {
    name: "Reuters Business",
    url: "https://feeds.reuters.com/reuters/businessNews",
    scope: ["GLOBAL", "ENERGY"],
  },
  {
    name: "BleepingComputer",
    url: "https://www.bleepingcomputer.com/feed/",
    scope: ["CYBER"],
  },
  {
    name: "The Hacker News",
    url: "https://thehackernews.com/feeds/posts/default",
    scope: ["CYBER"],
  },
  {
    name: "Krebs on Security",
    url: "https://krebsonsecurity.com/feed/",
    scope: ["CYBER"],
  },
  {
    name: "AP World",
    url: "https://feeds.apnews.com/apnews/worldnews",
    scope: ["GLOBAL", "CONFLICT"],
  },
  {
    name: "AP Technology",
    url: "https://feeds.apnews.com/apnews/technology",
    scope: ["CYBER"],
  },
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function extractItems(parsed: Record<string, unknown>): Array<{
  title?: string;
  link?: string | { "#text"?: string; "@_href"?: string };
  description?: string;
  summary?: string;
  pubDate?: string;
  published?: string;
  updated?: string;
  "dc:date"?: string;
  content?: string;
}> {
  const channel = (parsed as Record<string, { item?: unknown }>)?.rss?.channel;
  if (channel) {
    const items = (channel as Record<string, unknown>).item;
    if (Array.isArray(items)) return items;
    if (items) return [items as object];
  }
  const feed = (parsed as Record<string, { entry?: unknown }>)?.feed;
  if (feed) {
    const entries = (feed as Record<string, unknown>).entry;
    if (Array.isArray(entries)) return entries;
    if (entries) return [entries as object];
  }
  return [];
}

function resolveLink(link: unknown): string {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (typeof link === "object" && link !== null) {
    const obj = link as Record<string, string>;
    return obj["@_href"] || obj["#text"] || "";
  }
  return "";
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchFeed(
  feed: FeedDef,
  windowMs: number
): Promise<RawCandidate[]> {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": "RSR-Scribe-Feed-Reader/3.0" },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml = await res.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const items = extractItems(parsed);

  const cutoff = Date.now() - windowMs;
  const candidates: RawCandidate[] = [];

  for (const item of items) {
    const title = item.title;
    const link = resolveLink(item.link);
    if (!title || !link) continue;

    const rawDate =
      item.pubDate ||
      item.published ||
      item.updated ||
      item["dc:date"] ||
      new Date().toISOString();
    const publishedAt = new Date(String(rawDate)).toISOString();
    if (isNaN(new Date(publishedAt).getTime())) continue;

    const ts = new Date(publishedAt).getTime();
    if (ts < cutoff) continue;

    const rawDesc =
      item.description || item.summary || item.content || "";
    const summary = stripHtml(String(rawDesc)).slice(0, 300);

    candidates.push({
      headline: stripHtml(String(title)).slice(0, 200),
      url: link,
      summary,
      publishedAt,
      sourceHost: extractHost(link),
      feedName: feed.name,
      scope: feed.scope[0],
    });
  }

  return candidates;
}

export const WINDOW_MAP: Record<string, number> = {
  "1H": 3600000,
  "3H": 3 * 3600000,
  "6H": 6 * 3600000,
  "12H": 12 * 3600000,
  "24H": 24 * 3600000,
};

export async function fetchCandidates(
  scope: string,
  windowCode: string,
  logs: string[]
): Promise<RawCandidate[]> {
  const windowMs = WINDOW_MAP[windowCode] ?? WINDOW_MAP["6H"];
  const relevant = FEEDS.filter((f) => f.scope.includes(scope));

  const results = await Promise.allSettled(
    relevant.map(async (feed) => {
      const items = await fetchFeed(feed, windowMs);
      logs.push(`[FEED] ${feed.name} returned ${items.length} items`);
      return items;
    })
  );

  const all: RawCandidate[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      all.push(...r.value);
    }
  }

  const seen = new Set<string>();
  const deduped = all.filter((c) => {
    const key = c.headline.toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  logs.push(`[RANK] ${deduped.length} candidates after dedup`);
  return deduped;
}

export function rankCandidates(
  candidates: RawCandidate[],
  scope: string
): RawCandidate[] {
  const URGENCY_TERMS = [
    "breaking",
    "alert",
    "warning",
    "critical",
    "emergency",
    "urgent",
    "attack",
    "crisis",
    "killed",
    "dead",
    "explosion",
    "strike",
    "invasion",
    "escalat",
    "threat",
    "sanctions",
    "hack",
    "breach",
    "leak",
    "shutdown",
  ];

  const SCOPE_BOOSTS: Record<string, string[]> = {
    CONFLICT: ["war", "conflict", "military", "troops", "ceasefire", "nato", "battle", "missile", "attack", "russia", "ukraine", "israel", "iran", "china"],
    ENERGY: ["oil", "gas", "energy", "barrel", "opec", "pipeline", "lng", "crude", "power", "electricity", "fuel", "carbon", "climate"],
    CYBER: ["hack", "breach", "malware", "ransomware", "vuln", "cve", "exploit", "infra", "attack", "zero-day", "phishing", "backdoor"],
    GLOBAL: [],
  };

  const boostTerms = SCOPE_BOOSTS[scope] || [];
  const now = Date.now();

  return candidates
    .map((c) => {
      const lower = (c.headline + " " + c.summary).toLowerCase();
      const ageMs = now - new Date(c.publishedAt).getTime();
      const ageFactor = Math.max(0, 1 - ageMs / (24 * 3600000));
      const urgencyCount = URGENCY_TERMS.filter((t) => lower.includes(t)).length;
      const scopeCount = boostTerms.filter((t) => lower.includes(t)).length;
      const score = Math.round(ageFactor * 50 + urgencyCount * 8 + scopeCount * 10);
      return { ...c, score };
    })
    .sort((a, b) => (b as typeof b & { score: number }).score - (a as typeof a & { score: number }).score)
    .slice(0, 10) as (RawCandidate & { score: number })[];
}
