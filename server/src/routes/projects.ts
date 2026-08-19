import { and, desc, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { db, vars } from "edgespark";
import { auth } from "edgespark/http";
import { generationJobs, projects, scriptAnalyses, scriptVersions, videoOutputs } from "@defs";
import { analyzeTalkingScript, DeepSeekRequestError, generateTalkingScript, getDeepSeekApiBase } from "../services/deepseek";
import { AppRequestError, getUserProviderKey, requireActiveAccess, safeJson } from "../services/user-providers";

function fail(c: Context, error: unknown) {
  if (error instanceof DeepSeekRequestError) {
    const status = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 503 ? 503 : 502;
    return c.json({ ok: false as const, error: { code: error.code, message: error.message } }, status);
  }
  if (error instanceof AppRequestError) {
    return c.json({ ok: false as const, error: { code: error.code, message: error.message, requestId: error.requestId } }, error.status);
  }
  console.error("Project route error", error instanceof Error ? error.message : "unknown");
  return c.json({ ok: false as const, error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, 500);
}

async function ownedProject(userId: string, projectId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId))).limit(1);
  if (!project) throw new AppRequestError("PROJECT_NOT_FOUND", "项目不存在", 404);
  return project;
}

export const projectRoutes = new Hono()
  .get("/api/projects", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const rows = await db.select().from(projects).where(eq(projects.userId, auth.user.id)).orderBy(desc(projects.updatedAt));
      const result = await Promise.all(rows.map(async (project) => {
        const [latest] = await db.select().from(scriptVersions).where(eq(scriptVersions.projectId, project.id)).orderBy(desc(scriptVersions.createdAt)).limit(1);
        const jobs = await db.select({ id: generationJobs.id, status: generationJobs.status, type: generationJobs.type }).from(generationJobs).where(eq(generationJobs.projectId, project.id));
        return { ...project, latestScript: latest ?? null, jobCount: jobs.length, latestJobStatus: jobs.at(-1)?.status ?? null };
      }));
      return c.json({ ok: true, data: result });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/projects", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const body = await c.req.json<{ title?: string; rawIdeas?: string }>().catch(() => ({} as { title?: string; rawIdeas?: string }));
      const ideas = (body.rawIdeas || "").trim();
      if (!ideas) throw new AppRequestError("IDEAS_REQUIRED", "请先输入你的零散想法", 400);
      const now = Date.now();
      const [project] = await db.insert(projects).values({
        id: crypto.randomUUID(), userId: auth.user.id,
        title: (body.title || Array.from(ideas).slice(0, 18).join("") || "新建口播项目").trim(),
        rawIdeas: ideas, status: "draft", createdAt: now, updatedAt: now,
      }).returning();
      return c.json({ ok: true, data: project }, 201);
    } catch (error) { return fail(c, error); }
  })
  .get("/api/projects/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const [scripts, analyses, jobs, outputs] = await Promise.all([
        db.select().from(scriptVersions).where(eq(scriptVersions.projectId, project.id)).orderBy(desc(scriptVersions.createdAt)),
        db.select().from(scriptAnalyses).where(eq(scriptAnalyses.projectId, project.id)).orderBy(desc(scriptAnalyses.updatedAt)),
        db.select().from(generationJobs).where(eq(generationJobs.projectId, project.id)).orderBy(desc(generationJobs.createdAt)),
        db.select().from(videoOutputs).where(eq(videoOutputs.projectId, project.id)).orderBy(desc(videoOutputs.createdAt)),
      ]);
      return c.json({ ok: true, data: { ...project, scripts: scripts.map((v) => ({ ...v, settings: safeJson(v.settingsJson, {}) })), analyses: analyses.map((row) => ({ ...row, alternativeTitles: safeJson(row.alternativeTitlesJson, []), keywords: safeJson(row.keywordsJson, []), animationPlan: safeJson(row.animationPlanJson, []) })), jobs, outputs } });
    } catch (error) { return fail(c, error); }
  })
  .patch("/api/projects/:id", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const body = await c.req.json<{ title?: string; rawIdeas?: string; status?: string }>().catch(() => ({} as { title?: string; rawIdeas?: string; status?: string }));
      const [updated] = await db.update(projects).set({
        title: body.title?.trim() || project.title,
        rawIdeas: body.rawIdeas === undefined ? project.rawIdeas : body.rawIdeas.trim(),
        status: body.status || project.status,
        updatedAt: Date.now(),
      }).where(eq(projects.id, project.id)).returning();
      return c.json({ ok: true, data: updated });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/projects/:id/scripts/generate", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const body = await c.req.json<{ ideas?: string; tone?: string; audience?: string; durationSeconds?: number; extra?: string }>().catch(() => ({} as { ideas?: string; tone?: string; audience?: string; durationSeconds?: number; extra?: string }));
      const ideas = (body.ideas || project.rawIdeas).trim();
      if (!ideas) throw new AppRequestError("IDEAS_REQUIRED", "请先输入零散想法", 400);
      const apiKey = await getUserProviderKey(auth.user.id, "deepseek");
      const generated = await generateTalkingScript(apiKey, getDeepSeekApiBase(vars.get("DEEPSEEK_API_BASE")), { ...body, ideas });
      const now = Date.now();
      const [version] = await db.batch([
        db.insert(scriptVersions).values({
          id: crypto.randomUUID(), projectId: project.id, content: generated.content,
          settingsJson: JSON.stringify({ tone: body.tone, audience: body.audience, durationSeconds: body.durationSeconds, extra: body.extra, hook: generated.hook, closing: generated.closing, estimatedSeconds: generated.estimatedSeconds, model: generated.model, structure: generated.structure, characterCount: generated.characterCount, inputMode: "ai", confirmed: false }),
          source: "deepseek", createdAt: now,
        }).returning(),
        db.update(projects).set({ title: generated.title, rawIdeas: ideas, status: "script_ready", updatedAt: now }).where(eq(projects.id, project.id)),
      ]);
      return c.json({ ok: true, data: { project: { ...project, title: generated.title, rawIdeas: ideas, status: "script_ready", updatedAt: now }, version: version[0], generated } });
    } catch (error) { return fail(c, error); }
  })
  .post("/api/projects/:id/scripts", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const body = await c.req.json<{ content?: string; source?: "manual" | "deepseek"; settings?: Record<string, unknown> }>().catch(() => ({} as { content?: string; source?: "manual" | "deepseek"; settings?: Record<string, unknown> }));
      const content = (body.content || "").trim();
      if (!content) throw new AppRequestError("SCRIPT_REQUIRED", "口播文案不能为空", 400);
      const characterCount = Array.from(content.replace(/\s/gu, "")).length;
      if (characterCount > 1300) throw new AppRequestError("SCRIPT_TOO_LONG", `当前共${characterCount}字，超过1300字上限${characterCount - 1300}字，请删减后继续`, 400);
      const now = Date.now();
      const [version] = await db.batch([
        db.insert(scriptVersions).values({ id: crypto.randomUUID(), projectId: project.id, content, settingsJson: JSON.stringify({ ...(body.settings || {}), characterCount }), source: body.source === "deepseek" ? "deepseek" : "manual", createdAt: now }).returning(),
        db.update(projects).set({ status: "script_ready", updatedAt: now }).where(eq(projects.id, project.id)),
      ]);
      return c.json({ ok: true, data: version[0] }, 201);
    } catch (error) { return fail(c, error); }
  })
  .post("/api/projects/:id/scripts/:versionId/analyze", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const [version] = await db.select().from(scriptVersions).where(and(eq(scriptVersions.id, c.req.param("versionId")), eq(scriptVersions.projectId, project.id))).limit(1);
      if (!version) throw new AppRequestError("SCRIPT_NOT_FOUND", "文案版本不存在", 404);
      const apiKey = await getUserProviderKey(auth.user.id, "deepseek");
      const result = await analyzeTalkingScript(apiKey, getDeepSeekApiBase(vars.get("DEEPSEEK_API_BASE")), version.content);
      const now = Date.now();
      const [row] = await db.insert(scriptAnalyses).values({
        id: crypto.randomUUID(), userId: auth.user.id, projectId: project.id, scriptVersionId: version.id,
        coreTitle: result.coreTitle, alternativeTitlesJson: JSON.stringify(result.alternativeTitles),
        coverSubtitle: result.coverSubtitle, keywordsJson: JSON.stringify(result.keywords), contentType: result.contentType,
        emotion: result.emotion, animationPlanJson: JSON.stringify(result.animationPlan), confirmed: false,
        createdAt: now, updatedAt: now,
      }).onConflictDoUpdate({
        target: scriptAnalyses.scriptVersionId,
        set: { coreTitle: result.coreTitle, alternativeTitlesJson: JSON.stringify(result.alternativeTitles), coverSubtitle: result.coverSubtitle, keywordsJson: JSON.stringify(result.keywords), contentType: result.contentType, emotion: result.emotion, animationPlanJson: JSON.stringify(result.animationPlan), confirmed: false, updatedAt: now },
      }).returning();
      await db.update(projects).set({ title: result.coreTitle, updatedAt: now }).where(eq(projects.id, project.id));
      return c.json({ ok: true, data: { ...row, alternativeTitles: result.alternativeTitles, keywords: result.keywords, animationPlan: result.animationPlan } });
    } catch (error) { return fail(c, error); }
  })
  .patch("/api/projects/:id/analyses/:analysisId", async (c) => {
    if (!auth.user) return c.json({ ok: false, error: { code: "UNAUTHENTICATED" } }, 401);
    try {
      await requireActiveAccess(auth.user.id);
      const project = await ownedProject(auth.user.id, c.req.param("id"));
      const [analysis] = await db.select().from(scriptAnalyses).where(and(eq(scriptAnalyses.id, c.req.param("analysisId")), eq(scriptAnalyses.projectId, project.id), eq(scriptAnalyses.userId, auth.user.id))).limit(1);
      if (!analysis) throw new AppRequestError("ANALYSIS_NOT_FOUND", "标题分析不存在", 404);
      const body = await c.req.json<{ coreTitle?: string; coverSubtitle?: string; confirmed?: boolean }>().catch(() => ({} as { coreTitle?: string; coverSubtitle?: string; confirmed?: boolean }));
      const coreTitle = (body.coreTitle ?? analysis.coreTitle).trim().slice(0, 32);
      if (!coreTitle) throw new AppRequestError("TITLE_REQUIRED", "请填写核心标题", 400);
      const now = Date.now();
      const [updated] = await db.batch([
        db.update(scriptAnalyses).set({ coreTitle, coverSubtitle: (body.coverSubtitle ?? analysis.coverSubtitle).trim().slice(0, 40), confirmed: body.confirmed ?? analysis.confirmed, updatedAt: now }).where(eq(scriptAnalyses.id, analysis.id)).returning(),
        db.update(projects).set({ title: coreTitle, updatedAt: now }).where(eq(projects.id, project.id)),
      ]);
      return c.json({ ok: true, data: { ...updated[0], alternativeTitles: safeJson(updated[0].alternativeTitlesJson, []), keywords: safeJson(updated[0].keywordsJson, []), animationPlan: safeJson(updated[0].animationPlanJson, []) } });
    } catch (error) { return fail(c, error); }
  });
