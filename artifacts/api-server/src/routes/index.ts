import { Router, type IRouter } from "express";
import healthRouter from "./health";
import botRouter from "./bot";
import userAppRouter from "./user-app";

const router: IRouter = Router();

router.use(healthRouter);
router.use(botRouter);
router.use(userAppRouter);

export default router;
