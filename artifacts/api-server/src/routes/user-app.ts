import { Router, type IRouter } from "express";
import {
  CreateWalletChallengeBody,
  GetUserBotDashboardResponse,
  SetupUserBotBody,
  SetupUserBotResponse,
  StartUserBotResponse,
  StopUserBotResponse,
  VerifyWalletChallengeBody,
  VerifyWalletChallengeResponse,
  VerifyBotActivationBody,
  VerifyBotActivationResponse,
  CreateWalletChallengeResponse,
  ChangeUserBotCovenantBody,
  ChangeUserBotCovenantResponse,
  PrepareUserBotKasWithdrawalBody,
  PrepareUserBotKasWithdrawalResponse,
  SellAllUserBotManagedPositionsResponse,
  SubmitUserBotKasWithdrawalBody,
  SubmitUserBotKasWithdrawalResponse,
} from "@workspace/api-zod";
import {
  changeUserBotCovenant,
  createWalletChallenge,
  getGuestDashboard,
  getUserDashboard,
  readSessionToken,
  sessionCookieName,
  setUserBotRunning,
  setupUserBot,
  verifyActivation,
  verifyWalletChallenge,
} from "../lib/user-app-service";
import {
  prepareUserBotKasWithdrawal,
  submitUserBotKasWithdrawal,
} from "../lib/bot-withdrawal-service";
import { sellAllUserBotManagedPositions } from "../lib/bot-sell-all-service";

const router: IRouter = Router();
const cookie = (req: any) => req.cookies?.[sessionCookieName()] as string | undefined;
const userId = (req: any) => {
  const id = readSessionToken(cookie(req));
  if (!id) throw new Error("Connect and verify your wallet first.");
  return id;
};
const publicErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Request failed";
  // Drizzle wraps transient Postgres disconnects as "Failed query: … Connection terminated…"
  if (/connection terminated|ECONNREFUSED|ECONNRESET|timeout|ENOTFOUND|connect ETIMEDOUT/i.test(message)) {
    return "Database temporarily unavailable. Retry in a few seconds. If this keeps happening on Fly trial, add a payment method so Machines stay running.";
  }
  if (/^Failed query:/i.test(message)) {
    return "Database request failed. Retry connect; if it persists, check Fly Postgres is running.";
  }
  return message;
};

const handler = (fn: (req: any, res: any) => Promise<void>) => async (req: any, res: any) => {
  try {
    await fn(req, res);
  } catch (error) {
    req.log.warn({ err: error }, "User bot request blocked");
    res.status(400).json({ error: publicErrorMessage(error) });
  }
};

router.post("/app/auth/challenge", handler(async (req, res) => {
  const input = CreateWalletChallengeBody.parse(req.body);
  res.json(CreateWalletChallengeResponse.parse(await createWalletChallenge(input.walletAddress, input.publicKey)));
}));

router.post("/app/auth/verify", handler(async (req, res) => {
  const input = VerifyWalletChallengeBody.parse(req.body);
  const result = await verifyWalletChallenge(input);
  res.cookie(sessionCookieName(), result.token, {
    httpOnly: true,
    // Cross-site UI→API needs SameSite=None; same-origin /api keeps Lax.
    sameSite: process.env.COOKIE_SAME_SITE === "none" ? "none" : "lax",
    secure:
      process.env.COOKIE_SAME_SITE === "none" ||
      process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60_000,
  });
  res.json(VerifyWalletChallengeResponse.parse(await getUserDashboard(result.userId)));
}));

router.post("/app/auth/logout", (req, res) => {
  res.clearCookie(sessionCookieName());
  res.status(204).end();
});

router.get("/app/dashboard", handler(async (req, res) => {
  const id = readSessionToken(cookie(req));
  res.json(GetUserBotDashboardResponse.parse(
    id ? await getUserDashboard(id) : getGuestDashboard(),
  ));
}));

router.post("/app/bot/setup", handler(async (req, res) => {
  const input = SetupUserBotBody.parse(req.body);
  res.json(SetupUserBotResponse.parse(await setupUserBot(userId(req), input.tokenId)));
}));

router.post("/app/bot/activation/verify", handler(async (req, res) => {
  const input = VerifyBotActivationBody.parse(req.body);
  res.json(VerifyBotActivationResponse.parse(await verifyActivation(userId(req), input.transactionId)));
}));

router.post("/app/bot/covenant/change", handler(async (req, res) => {
  const input = ChangeUserBotCovenantBody.parse(req.body);
  res.json(ChangeUserBotCovenantResponse.parse(await changeUserBotCovenant(userId(req), input.tokenId)));
}));

router.post("/app/bot/start", handler(async (req, res) => {
  res.json(StartUserBotResponse.parse(await setUserBotRunning(userId(req), true)));
}));

router.post("/app/bot/stop", handler(async (req, res) => {
  res.json(StopUserBotResponse.parse(await setUserBotRunning(userId(req), false)));
}));

router.post("/app/bot/sell-all", handler(async (req, res) => {
  res.json(SellAllUserBotManagedPositionsResponse.parse(
    await sellAllUserBotManagedPositions(userId(req)),
  ));
}));

router.post("/app/bot/withdraw", handler(async (req, res) => {
  const input = PrepareUserBotKasWithdrawalBody.parse(req.body);
  res.json(PrepareUserBotKasWithdrawalResponse.parse(
    await prepareUserBotKasWithdrawal(userId(req), input),
  ));
}));

router.post("/app/bot/withdraw/submit", handler(async (req, res) => {
  const input = SubmitUserBotKasWithdrawalBody.parse(req.body);
  res.json(SubmitUserBotKasWithdrawalResponse.parse(
    await submitUserBotKasWithdrawal(userId(req), input.signedTransaction),
  ));
}));

export default router;