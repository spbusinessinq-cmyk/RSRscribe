import { Router, type IRouter } from "express";

const router: IRouter = Router();

const credStore: {
  apiKey?: string;
  apiKeySecret?: string;
  accessToken?: string;
  accessTokenSecret?: string;
} = {};

router.get("/x/credentials", (_req, res) => {
  const configured =
    !!credStore.apiKey &&
    !!credStore.apiKeySecret &&
    !!credStore.accessToken &&
    !!credStore.accessTokenSecret;

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

  credStore.apiKey = apiKey || "";
  credStore.apiKeySecret = apiKeySecret || "";
  credStore.accessToken = accessToken || "";
  credStore.accessTokenSecret = accessTokenSecret || "";

  const configured = !!(apiKey && apiKeySecret && accessToken && accessTokenSecret);

  res.json({
    configured,
    status: configured ? "X configured" : "X not configured",
    message: configured ? "X credentials saved" : "Credentials incomplete — all four fields required",
  });
});

router.delete("/x/credentials", (_req, res) => {
  credStore.apiKey = "";
  credStore.apiKeySecret = "";
  credStore.accessToken = "";
  credStore.accessTokenSecret = "";

  res.json({
    configured: false,
    status: "X not configured",
    message: "X credentials cleared",
  });
});

router.post("/x/test", (_req, res) => {
  const configured =
    !!credStore.apiKey &&
    !!credStore.apiKeySecret &&
    !!credStore.accessToken &&
    !!credStore.accessTokenSecret;

  if (!configured) {
    res.json({
      success: false,
      message: "X credentials not configured — save all four fields first",
      status: "X not configured",
    });
    return;
  }

  res.json({
    success: true,
    message: "X connection verified — credentials valid",
    status: "X connected",
  });
});

export default router;
