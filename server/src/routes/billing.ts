import { Hono } from "hono";
import { auth } from "edgespark/http";

const annualPlan = {
  code: "annual_2800",
  name: "口播智能体年费会员",
  amountFen: 280000,
  currency: "CNY",
  billingCycle: "year",
  inviteAccessFree: true,
};

export const billingRoutes = new Hono()
  .get("/api/public/billing/plan", (c) => c.json({ ok: true, data: annualPlan }))
  .post("/api/billing/checkout", (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    return c.json({
      ok: false,
      error: {
        code: "PAYMENT_PROVIDER_REQUIRED",
        message: "年费为 ¥2800。支付通道正在配置，请联系管理员开通。",
      },
    }, 503);
  });
