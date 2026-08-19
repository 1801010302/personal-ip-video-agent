import { Hono } from "hono";
import { accessRoutes } from "./routes/access";
import { adminRoutes } from "./routes/admin";
import { billingRoutes } from "./routes/billing";
import { settingsRoutes } from "./routes/settings";
import { projectRoutes } from "./routes/projects";
import { mediaRoutes } from "./routes/media";
import { tutorialRoutes } from "./routes/tutorial";
import { imageGenSettingsRoutes } from "./routes/imagegen-settings";
import { coverRoutes } from "./routes/covers";
import { renderWorkerRoutes } from "./routes/render-worker";

const app = new Hono()
  .route("/", accessRoutes)
  .route("/", adminRoutes)
  .route("/", billingRoutes)
  .route("/", settingsRoutes)
  .route("/", projectRoutes)
  .route("/", mediaRoutes)
  .route("/", tutorialRoutes)
  .route("/", imageGenSettingsRoutes)
  .route("/", coverRoutes)
  .route("/", renderWorkerRoutes)
  .notFound((c) =>
    c.json({ ok: false, error: { code: "NOT_FOUND", message: "接口不存在" } }, 404),
  )
  .onError((error, c) => {
    console.error("Unhandled application error", {
      name: error.name,
      message: error.message,
    });
    return c.json(
      { ok: false, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } },
      500,
    );
  });

export default app;
