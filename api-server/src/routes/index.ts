import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import coursesRouter from "./courses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(coursesRouter);

export default router;
