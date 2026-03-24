import { XMLParser } from "fast-xml-parser";

export type RawCandidate = {
  headline: string;
  url: string;
  summary: string;
  publishedAt: string;
  sourceHost: string;
  feedName: string;
  scope: string;
  clusterSize?: number;
  clusterUrls?: string[];
  clusterFeeds?: string[];
};

type FeedDef = { name: string; url: string; scope: string[]; priority: number };

const FEEDS: FeedDef[] = [
  { name: "BBC World",         url: "https://feeds.bbci.co.uk/news/world/rss.xml",          scope: ["GLOBAL", "CONFLICT"], priority: 2 },
  { name: "Al Jazeera World",  url: "https://www.aljazeera.com/xml/rss/all.xml",             scope: ["GLOBAL", "CONFLICT"], priority: 2 },
  { name: "AP World",          url: "https://feeds.apnews.com/apnews/worldnews",             scope: ["GLOBAL", "CONFLICT"], priority: 1 },
  { name: "Reuters World",     url: "https://feeds.reuters.com/Reuters/worldNews",           scope: ["GLOBAL", "CONFLICT"], priority: 3 },
  { name: "BBC Business",      url: "https://feeds.bbci.co.uk/news/business/rss.xml",        scope: ["GLOBAL", "ENERGY"],   priority: 2 },
  { name: "Reuters Business",  url: "https://feeds.reuters.com/reuters/businessNews",        scope: ["GLOBAL", "ENERGY"],   priority: 1 },
  { name: "The Hacker News",   url: "https://thehackernews.com/feeds/posts/default",         scope: ["CYBER"],              priority: 1 },
  { name: "BleepingComputer",  url: "https://www.bleepingcomputer.com/feed/",                scope: ["CYBER"],              priority: 2 },
  { name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/",                     scope: ["CYBER"],              priority: 3 },
  { name: "AP Technology",     url: "https://feeds.apnews.com/apnews/technology",            scope: ["CYBER"],              priority: 3 },
];

const MAX_FEEDS_PER_SCOPE = 4;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });

type CacheEntry = { data: RawCandidate[]; expiresAt: number };
const feedCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 75_000;

// ── CLUSTER ENGINE ─────────────────────────────────────────────────────────────
const STOPWORDS = new Set([
  "the","a","an","in","on","at","to","for","of","and","or","is","are","was","were",
  "be","been","have","has","had","will","would","could","should","may","might","its",
  "this","that","with","from","by","as","over","after","before","about","into","also",
  "than","more","when","who","which","what","where","how","new","says","say",
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

function clusterCandidates(candidates: RawCandidate[]): RawCandidate[] {
  if (candidates.length === 0) return [];
  const keywords = candidates.map((c) => extractKeywords(c.headline + " " + c.summary.slice(0, 120)));
  const assigned = new Array(candidates.length).fill(-1);
  const clusters: { leadIdx: number; memberIdxs: number[] }[] = [];

  for (let i = 0; i < candidates.length; i++) {
    if (assigned[i] !== -1) continue;
    const cluster = { leadIdx: i, memberIdxs: [i] };
    assigned[i] = clusters.length;
    for (let j = i + 1; j < candidates.length; j++) {
      if (assigned[j] !== -1) continue;
      if (jaccardSimilarity(keywords[i], keywords[j]) >= 0.28) {
        cluster.memberIdxs.push(j);
        assigned[j] = clusters.length;
      }
    }
    clusters.push(cluster);
  }

  return clusters.map((cl) => ({
    ...candidates[cl.leadIdx],
    clusterSize: cl.memberIdxs.length,
    clusterUrls: cl.memberIdxs.map((i) => candidates[i].url),
    clusterFeeds: [...new Set(cl.memberIdxs.map((i) => candidates[i].feedName))],
  }));
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function extractHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function extractItems(parsed: Record<string, unknown>): Array<{
  title?: string; link?: string | { "#text"?: string; "@_href"?: string };
  description?: string; summary?: string; pubDate?: string;
  published?: string; updated?: string; "dc:date"?: string; content?: string;
}> {
  const rss = (parsed as Record<string, Record<string, unknown>>)?.rss;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  if (channel) {
    const items = channel.item;
    if (Array.isArray(items)) return items;
    if (items) return [items as object];
  }
  const feed = (parsed as Record<string, Record<string, unknown>>)?.feed;
  if (feed) {
    const entries = feed.entry;
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

async function fetchFeed(feed: FeedDef, windowMs: number): Promise<RawCandidate[]> {
  const cacheKey = `${feed.url}::${windowMs}`;
  const cached = feedCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) return cached.data;

  const res = await fetch(feed.url, {
    headers: { "User-Agent": "RSR-Scribe-Feed-Reader/4.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const xml  = await res.text();
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const items = extractItems(parsed);
  const cutoff = Date.now() - windowMs;
  const candidates: RawCandidate[] = [];

  for (const item of items) {
    const title = item.title;
    const link = resolveLink(item.link);
    if (!title || !link) continue;
    const rawDate = item.pubDate || item.published || item.updated || item["dc:date"] || new Date().toISOString();
    const publishedAt = new Date(String(rawDate)).toISOString();
    if (isNaN(new Date(publishedAt).getTime())) continue;
    if (new Date(publishedAt).getTime() < cutoff) continue;
    const rawDesc = item.description || item.summary || item.content || "";
    const summary = stripHtml(String(rawDesc)).slice(0, 280);
    candidates.push({
      headline: stripHtml(String(title)).slice(0, 200),
      url: link, summary, publishedAt,
      sourceHost: extractHost(link),
      feedName: feed.name,
      scope: feed.scope[0],
      clusterSize: 1, clusterUrls: [link], clusterFeeds: [feed.name],
    });
  }

  feedCache.set(cacheKey, { data: candidates, expiresAt: Date.now() + CACHE_TTL_MS });
  return candidates;
}

export const WINDOW_MAP: Record<string, number> = {
  "1H": 3_600_000, "3H": 3 * 3_600_000, "6H": 6 * 3_600_000, "12H": 12 * 3_600_000, "24H": 24 * 3_600_000,
};

export async function fetchCandidates(scope: string, windowCode: string, logs: string[]): Promise<RawCandidate[]> {
  const windowMs = WINDOW_MAP[windowCode] ?? WINDOW_MAP["6H"];
  const relevant = FEEDS.filter((f) => f.scope.includes(scope)).sort((a, b) => a.priority - b.priority).slice(0, MAX_FEEDS_PER_SCOPE);

  const t0 = Date.now();
  const results = await Promise.allSettled(
    relevant.map(async (feed) => {
      const ft = Date.now();
      const items = await fetchFeed(feed, windowMs);
      logs.push(`[FEED] ${feed.name}: ${items.length} items (${Date.now() - ft}ms)`);
      return items;
    })
  );
  logs.push(`[TIMER] feed fetch: ${Date.now() - t0}ms`);

  const all: RawCandidate[] = [];
  for (const r of results) { if (r.status === "fulfilled") all.push(...r.value); }

  // Exact dedup by URL
  const seenUrls = new Set<string>();
  const deduped = all.filter((c) => { if (seenUrls.has(c.url)) return false; seenUrls.add(c.url); return true; });

  // Semantic clustering
  const clustered = clusterCandidates(deduped);
  const multiCluster = clustered.filter((c) => (c.clusterSize ?? 1) > 1).length;
  logs.push(`[CLUSTER] ${clustered.length} signals (${multiCluster} multi-source clusters) from ${deduped.length} raw items`);

  return clustered;
}

export function rankCandidates(candidates: RawCandidate[], scope: string): RawCandidate[] {
  const URGENCY_TERMS = [
    "breaking", "alert", "warning", "critical", "emergency", "urgent",
    "attack", "crisis", "killed", "dead", "explosion", "strike", "invasion",
    "escalat", "threat", "sanctions", "hack", "breach", "leak", "shutdown",
  ];
  const SCOPE_BOOSTS: Record<string, string[]> = {
    CONFLICT: ["war", "conflict", "military", "troops", "ceasefire", "nato", "battle", "missile", "attack", "russia", "ukraine", "israel", "iran", "china"],
    ENERGY:   ["oil", "gas", "energy", "barrel", "opec", "pipeline", "lng", "crude", "power", "electricity", "fuel", "carbon", "climate"],
    CYBER:    ["hack", "breach", "malware", "ransomware", "vuln", "cve", "exploit", "infra", "attack", "zero-day", "phishing", "backdoor"],
    GLOBAL:   [],
  };

  const boostTerms = SCOPE_BOOSTS[scope] || [];
  const now = Date.now();

  return candidates
    .map((c) => {
      const lower = (c.headline + " " + c.summary).toLowerCase();
      const ageFactor = Math.max(0, 1 - (now - new Date(c.publishedAt).getTime()) / (24 * 3_600_000));
      const urgencyCount = URGENCY_TERMS.filter((t) => lower.includes(t)).length;
      const scopeCount = boostTerms.filter((t) => lower.includes(t)).length;
      const clusterBonus = Math.min(((c.clusterSize ?? 1) - 1) * 6, 18); // up to +18 for multi-source
      const score = Math.round(ageFactor * 50 + urgencyCount * 8 + scopeCount * 10 + clusterBonus);
      return { ...c, score };
    })
    .sort((a, b) => (b as typeof b & { score: number }).score - (a as typeof a & { score: number }).score)
    .slice(0, 12) as (RawCandidate & { score: number })[];
}
