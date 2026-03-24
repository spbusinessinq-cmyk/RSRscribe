import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";

export type IngestResult = {
  headline: string;
  body: string;
  claims: string[];
  extracted: boolean;
  sourceHost: string;
  issue?: string;
};

function extractHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Hard timeout wrapper — AbortSignal.timeout() alone does not cancel OS-level TCP connection hangs.
async function withHardTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`hard timeout ${ms}ms — ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await withHardTimeout(
    fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; RSR-Scribe/3.0)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    }),
    11000,
    url
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return withHardTimeout(res.text(), 8000, `body read ${url}`);
}

function readabilityExtract(html: string, url: string): string | null {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article?.textContent || article.textContent.trim().length < 100) {
      return null;
    }
    return article.textContent.replace(/\s+/g, " ").trim();
  } catch {
    return null;
  }
}

function cheerioExtract(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    $("script, style, nav, header, footer, aside, iframe, [class*='ad'], [id*='ad']").remove();
    const paragraphs: string[] = [];
    $("p, article p, main p, .content p, .article-body p, .post-content p").each((_: number, el: cheerio.AnyNode) => {
      const text = $(el).text().trim();
      if (text.length > 40) paragraphs.push(text);
    });
    if (paragraphs.length < 2) return null;
    return paragraphs.join(" ").slice(0, 8000);
  } catch {
    return null;
  }
}

function extractClaims(body: string): string[] {
  const sentences = body
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 300);
  return sentences.slice(0, 8);
}

export async function ingestUrl(
  url: string,
  fallbackHeadline: string,
  logs: string[]
): Promise<IngestResult> {
  const sourceHost = extractHost(url);
  logs.push(`[INGEST] fetching ${url}`);

  let html: string;
  try {
    html = await fetchHtml(url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logs.push(`[INGEST] fetch failed — ${reason}`);
    return {
      headline: fallbackHeadline,
      body: "",
      claims: [],
      extracted: false,
      sourceHost,
      issue: `Fetch failed: ${reason}`,
    };
  }

  let body = readabilityExtract(html, url);
  if (body) {
    logs.push("[INGEST] readability extraction succeeded");
  } else {
    logs.push("[INGEST] readability failed, trying cheerio fallback");
    body = cheerioExtract(html);
    if (body) {
      logs.push("[INGEST] cheerio extraction succeeded");
    } else {
      logs.push("[INGEST] cheerio fallback failed");
    }
  }

  if (!body || body.length < 100) {
    return {
      headline: fallbackHeadline,
      body: "",
      claims: [],
      extracted: false,
      sourceHost,
      issue: "Article text could not be extracted from this source",
    };
  }

  const truncated = body.slice(0, 8000);
  const claims = extractClaims(truncated);

  return {
    headline: fallbackHeadline,
    body: truncated,
    claims,
    extracted: true,
    sourceHost,
  };
}
