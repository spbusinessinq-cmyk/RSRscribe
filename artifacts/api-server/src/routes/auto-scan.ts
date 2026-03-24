import { Router, type IRouter } from "express";
import { fetchCandidates, rankCandidates } from "../lib/feeds.js";
import { ingestUrl } from "../lib/ingest.js";
import { runPipeline } from "../lib/pipeline.js";

const router: IRouter = Router();

router.post("/auto-scan", async (req, res) => {
  const { scope = "GLOBAL", window: windowCode = "6H", leadUrl, outputMode = "THREAD" } = req.body as {
    scope?: string; window?: string; leadUrl?: string; outputMode?: string;
  };

  const t0 = Date.now();
  const logs: string[] = [];
  logs.push(`[AUTO SCAN] scope=${scope} window=${windowCode} mode=${outputMode}`);

  try {
    const tFeed = Date.now();
    const raw = await fetchCandidates(scope, windowCode, logs);
    logs.push(`[TIMER] feed+cluster: ${Date.now() - tFeed}ms`);

    if (raw.length === 0) {
      res.json({ success: false, reason: "No feed items found within the selected time window", candidates: [], logs });
      return;
    }

    const ranked = rankCandidates(raw, scope);
    logs.push(`[RANK] ${ranked.length} candidates — top score: ${(ranked[0] as typeof ranked[0] & { score: number })?.score ?? 0}`);

    const candidates = (ranked as Array<typeof ranked[0] & { score: number }>).map((c) => ({
      headline: c.headline,
      url: c.url,
      summary: c.summary,
      sourceHost: c.sourceHost,
      publishedAt: c.publishedAt,
      scope: c.scope,
      feedName: c.feedName,
      score: c.score ?? 0,
      clusterSize: c.clusterSize ?? 1,
      clusterUrls: c.clusterUrls ?? [c.url],
      clusterFeeds: c.clusterFeeds ?? [c.feedName],
    }));

    const targetUrl = leadUrl || candidates[0]?.url;
    if (!targetUrl) {
      res.json({ success: false, reason: "No usable candidate URL found", candidates, logs });
      return;
    }

    const targetCandidate = candidates.find((c) => c.url === targetUrl) || candidates[0];
    logs.push(`[INGEST] selected: ${targetCandidate.headline.slice(0, 80)} [cluster: ${targetCandidate.clusterSize}]`);

    const tIngest = Date.now();
    let ingest = await ingestUrl(targetUrl, targetCandidate.headline, logs);

    if (!ingest.extracted) {
      for (const alt of candidates.slice(1, 4)) {
        if (alt.url === targetUrl) continue;
        logs.push(`[INGEST] retry: ${alt.headline.slice(0, 60)}`);
        ingest = await ingestUrl(alt.url, alt.headline, logs);
        if (ingest.extracted) {
          targetCandidate.headline = alt.headline;
          targetCandidate.url = alt.url;
          targetCandidate.sourceHost = alt.sourceHost;
          targetCandidate.feedName = alt.feedName;
          targetCandidate.publishedAt = alt.publishedAt;
          break;
        }
      }
    }

    logs.push(`[TIMER] ingest: ${Date.now() - tIngest}ms`);

    if (!ingest.extracted) {
      res.json({
        success: false,
        reason: "Article extraction failed across all candidates",
        candidates, logs,
        cleanedSource: {
          readableText: "", headline: targetCandidate.headline, body: "", claims: [],
          sourceHost: targetCandidate.sourceHost, onlyUrlInput: false, extracted: false, issue: ingest.issue,
        },
      });
      return;
    }

    const tPipeline = Date.now();
    const pipeline = await runPipeline(
      ingest.headline, ingest.body, ingest.sourceHost, scope, logs,
      outputMode as import("../lib/pipeline.js").OutputMode,
      targetCandidate.clusterSize
    );
    logs.push(`[TIMER] AI pipeline: ${Date.now() - tPipeline}ms`);
    logs.push(`[TIMER] total: ${Date.now() - t0}ms`);

    const minSentrixForMode = (outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT") ? 1 : outputMode === "RAPID_FIRE" ? 2 : 3;
    const minAxionForMode   = (outputMode === "SINGLE_SIGNAL" || outputMode === "BREAKING_ALERT") ? 1 : outputMode === "RAPID_FIRE" ? 2 : 3;

    const ready =
      pipeline.sentrix.length >= minSentrixForMode &&
      pipeline.axion.length  >= minAxionForMode &&
      pipeline.sage.WHAT.length > 0 &&
      pipeline.blackDog.level !== "PENDING" &&
      !pipeline.blockedReason;

    logs.push(ready ? "[SCRIBE] DEPLOYMENT READY" : `[SCRIBE] blocked — ${pipeline.blockedReason || "pipeline incomplete"}`);

    res.json({
      success: true, mode: "AUTO_SCAN", scope, window: windowCode,
      leadCandidate: targetCandidate,
      candidates,
      sourceRecord: {
        headline: ingest.headline,
        content: ingest.body.slice(0, 500),
        timestamp: targetCandidate.publishedAt,
        sourceType: targetCandidate.clusterSize > 1 ? "CLUSTER" : "RSS",
        sourceHost: ingest.sourceHost,
        sourceUrl: targetUrl,
        summary: ingest.body.slice(0, 220),
        feedName: targetCandidate.feedName,
        clusterSize: targetCandidate.clusterSize,
        clusterFeeds: targetCandidate.clusterFeeds,
      },
      cleanedSource: {
        readableText: ingest.body, headline: ingest.headline, body: ingest.body,
        claims: ingest.claims, sourceHost: ingest.sourceHost, onlyUrlInput: false, extracted: true,
      },
      sentrix: pipeline.sentrix,
      sage: pipeline.sage,
      axion: pipeline.axion,
      blackDog: pipeline.blackDog,
      escalationScore: pipeline.escalationScore,
      ready, blockedReason: pipeline.blockedReason,
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`[AUTO SCAN] fatal — ${message}`);
    req.log.error({ err }, "auto-scan error");
    res.json({ success: false, reason: `AUTO SCAN failed: ${message}`, candidates: [], logs });
  }
});

export default router;
