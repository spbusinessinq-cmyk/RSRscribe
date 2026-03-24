import { Router, type IRouter } from "express";
import { fetchCandidates, rankCandidates } from "../lib/feeds.js";
import { ingestUrl } from "../lib/ingest.js";
import { runPipeline } from "../lib/pipeline.js";

const router: IRouter = Router();

router.post("/auto-scan", async (req, res) => {
  const { scope = "GLOBAL", window: windowCode = "6H", leadUrl } = req.body as {
    scope?: string;
    window?: string;
    leadUrl?: string;
  };

  const t0 = Date.now();
  const logs: string[] = [];
  logs.push(`[AUTO SCAN] started`);
  logs.push(`[AUTO SCAN] scope=${scope} window=${windowCode}`);

  try {
    const tFeed = Date.now();
    const raw = await fetchCandidates(scope, windowCode, logs);

    if (raw.length === 0) {
      logs.push("[AUTO SCAN] no candidates found in any feed");
      res.json({ success: false, reason: "No feed items found within the selected time window", candidates: [], logs });
      return;
    }

    const tRank = Date.now();
    const ranked = rankCandidates(raw, scope);
    logs.push(`[RANK] ${ranked.length} candidates scored and ranked`);
    logs.push(`[TIMER] ranking: ${Date.now() - tRank}ms`);

    const candidates = (ranked as Array<typeof ranked[0] & { score: number }>).map((c) => ({
      headline: c.headline,
      url: c.url,
      summary: c.summary,
      sourceHost: c.sourceHost,
      publishedAt: c.publishedAt,
      scope: c.scope,
      feedName: c.feedName,
      score: c.score ?? 0,
    }));

    const targetUrl = leadUrl || candidates[0]?.url;
    if (!targetUrl) {
      res.json({ success: false, reason: "No usable candidate URL found", candidates, logs });
      return;
    }

    const targetCandidate = candidates.find((c) => c.url === targetUrl) || candidates[0];
    logs.push(`[INGEST] lead candidate selected: ${targetCandidate.headline.slice(0, 80)}`);

    const tIngest = Date.now();
    let ingest = await ingestUrl(targetUrl, targetCandidate.headline, logs);

    if (!ingest.extracted) {
      for (const alt of candidates.slice(1, 4)) {
        if (alt.url === targetUrl) continue;
        logs.push(`[INGEST] retrying with: ${alt.headline.slice(0, 60)}`);
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
      logs.push("[INGEST] all candidates failed extraction");
      res.json({
        success: false,
        reason: "Fresh candidates found but readable article extraction failed",
        candidates,
        logs,
        cleanedSource: {
          readableText: "",
          headline: targetCandidate.headline,
          body: "",
          claims: [],
          sourceHost: targetCandidate.sourceHost,
          onlyUrlInput: false,
          extracted: false,
          issue: ingest.issue,
        },
      });
      return;
    }

    const tPipeline = Date.now();
    const pipeline = await runPipeline(ingest.headline, ingest.body, ingest.sourceHost, scope, logs);
    logs.push(`[TIMER] AI pipeline: ${Date.now() - tPipeline}ms`);
    logs.push(`[TIMER] total scan: ${Date.now() - t0}ms`);

    const ready =
      pipeline.sentrix.length >= 3 &&
      pipeline.axion.length >= 3 &&
      pipeline.sage.WHAT.length > 0 &&
      pipeline.blackDog.level !== "PENDING" &&
      !pipeline.blockedReason;

    if (ready) {
      logs.push("[SCRIBE] pipeline complete — deployment ready");
    } else {
      logs.push(`[SCRIBE] blocked — ${pipeline.blockedReason || "pipeline incomplete"}`);
    }

    res.json({
      success: true,
      mode: "AUTO_SCAN",
      scope,
      window: windowCode,
      leadCandidate: targetCandidate,
      candidates,
      sourceRecord: {
        headline: ingest.headline,
        content: ingest.body.slice(0, 500),
        timestamp: targetCandidate.publishedAt,
        sourceType: "URL",
        sourceHost: ingest.sourceHost,
        sourceUrl: targetUrl,
        summary: ingest.body.slice(0, 200),
        feedName: targetCandidate.feedName,
      },
      cleanedSource: {
        readableText: ingest.body,
        headline: ingest.headline,
        body: ingest.body,
        claims: ingest.claims,
        sourceHost: ingest.sourceHost,
        onlyUrlInput: false,
        extracted: true,
      },
      sentrix: pipeline.sentrix,
      sage: pipeline.sage,
      axion: pipeline.axion,
      blackDog: pipeline.blackDog,
      escalationScore: pipeline.escalationScore,
      ready,
      blockedReason: pipeline.blockedReason,
      logs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logs.push(`[AUTO SCAN] fatal error — ${message}`);
    logs.push(`[TIMER] failed after: ${Date.now() - t0}ms`);
    req.log.error({ err }, "auto-scan error");
    res.json({ success: false, reason: `AUTO SCAN failed: ${message}`, candidates: [], logs });
  }
});

export default router;
