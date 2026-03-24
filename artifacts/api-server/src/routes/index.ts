import { Router, type IRouter } from "express";
import healthRouter from "./health";
import autoScanRouter from "./auto-scan";
import xRouter from "./x";
import postRouter from "./post";

const router: IRouter = Router();

router.use(healthRouter);
router.use(autoScanRouter);
router.use(xRouter);
router.use(postRouter);

export default router;
