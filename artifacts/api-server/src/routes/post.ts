import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.post("/post", (req, res) => {
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

  const mockIds = lines.map((_, i) => `tweet_${Date.now()}_${i}`);

  res.json({
    success: true,
    postedCount: lines.length,
    ids: mockIds,
    message: `Thread posted — ${lines.length} posts published`,
  });
});

export default router;
