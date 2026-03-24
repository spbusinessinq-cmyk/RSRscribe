import { Router, type IRouter } from "express";
import { TwitterApi } from "twitter-api-v2";
import { xCredStore, isXConfigured } from "../lib/x-creds.js";

const router: IRouter = Router();

function buildClient(): TwitterApi {
  return new TwitterApi({
    appKey: xCredStore.apiKey,
    appSecret: xCredStore.apiKeySecret,
    accessToken: xCredStore.accessToken,
    accessSecret: xCredStore.accessTokenSecret,
  });
}

router.post("/post", async (req, res) => {
  const { preview, lines } = req.body as {
    preview?: boolean;
    mode?: string;
    lines?: string[];
  };

  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    res.status(400).json({
      success: false,
      postedCount: 0,
      ids: [],
      message: "No thread lines provided",
    });
    return;
  }

  if (preview) {
    res.json({
      success: true,
      postedCount: 0,
      ids: [],
      message: `Preview mode — ${lines.length} posts ready, not sent`,
    });
    return;
  }

  if (!isXConfigured()) {
    res.json({
      success: false,
      postedCount: 0,
      ids: [],
      message: "Posting blocked — X credentials not configured. Save credentials and run TEST CONNECTION first.",
    });
    return;
  }

  try {
    const client = buildClient().readWrite;
    const ids: string[] = [];
    let lastId: string | undefined;

    for (const line of lines) {
      const params: { text: string; reply?: { in_reply_to_tweet_id: string } } = { text: line };
      if (lastId) {
        params.reply = { in_reply_to_tweet_id: lastId };
      }
      const tweet = await client.v2.tweet(params);
      lastId = tweet.data.id;
      ids.push(lastId);
    }

    res.json({
      success: true,
      postedCount: ids.length,
      ids,
      message: `Thread posted — ${ids.length} tweets published`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = message.includes("401")
      ? "Posting blocked — X credentials rejected. Re-test connection before posting."
      : message.includes("403")
        ? "Posting blocked — X account lacks write permission. Check app access level."
        : message.includes("duplicate")
          ? "Posting blocked — duplicate content detected by X"
          : `Posting failed: ${message}`;
    res.json({
      success: false,
      postedCount: 0,
      ids: [],
      message: friendly,
    });
  }
});

export default router;
