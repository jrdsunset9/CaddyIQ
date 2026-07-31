import { Router, type IRouter } from "express";

const router: IRouter = Router();

// Both paths return the same payload — `/health` is the conventional name
// most platforms (Replit, Render, Fly) probe; `/healthz` is the k8s convention
// some others use. Cheap to support both.
router.get(["/health", "/healthz"], (_req, res) => {
  res.json({ status: "ok" });
});

export default router;
