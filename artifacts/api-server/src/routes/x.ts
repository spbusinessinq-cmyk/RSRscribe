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

router.get("/x/credentials", (_req, res) => {
  const configured = isXConfigured();
  res.json({
    configured,
    status: configured ? "X configured" : "X not configured",
    message: configured ? "X credentials saved" : "X credentials missing",
  });
});

router.post("/x/credentials", (req, res) => {
  const { apiKey, apiKeySecret, accessToken, accessTokenSecret } = req.body as {
    apiKey?: string;
    apiKeySecret?: string;
    accessToken?: string;
    accessTokenSecret?: string;
  };

  xCredStore.apiKey = apiKey?.trim() ?? "";
  xCredStore.apiKeySecret = apiKeySecret?.trim() ?? "";
  xCredStore.accessToken = accessToken?.trim() ?? "";
  xCredStore.accessTokenSecret = accessTokenSecret?.trim() ?? "";

  const configured = isXConfigured();
  res.json({
    configured,
    status: configured ? "X configured" : "X not configured",
    message: configured
      ? "X credentials saved"
      : "Credentials incomplete — all four fields required",
  });
});

router.delete("/x/credentials", (_req, res) => {
  xCredStore.apiKey = "";
  xCredStore.apiKeySecret = "";
  xCredStore.accessToken = "";
  xCredStore.accessTokenSecret = "";

  res.json({
    configured: false,
    status: "X not configured",
    message: "X credentials cleared",
  });
});

router.post("/x/test", async (req, res) => {
  if (!isXConfigured()) {
    res.json({
      success: false,
      message: "X credentials not configured — save all four fields first",
      status: "X not configured",
    });
    return;
  }

  try {
    const client = buildClient();
    const result = await client.v2.me();
    const username = result.data?.username || "unknown";
    res.json({
      success: true,
      message: `X connection verified — authenticated as @${username}`,
      status: "X connected",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const friendly = message.includes("401")
      ? "X credentials rejected — check all four fields are correct"
      : message.includes("403")
        ? "X account lacks write permission — check app access level"
        : `X test failed: ${message}`;
    res.json({
      success: false,
      message: friendly,
      status: "X test failed",
    });
  }
});

export default router;
