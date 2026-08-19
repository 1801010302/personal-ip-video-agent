import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { esSystemAuthUser } from "../__generated__/sys_schema";

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const appProfiles = sqliteTable(
  "app_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    role: text("role").notNull().default("user"),
    onboardingStep: text("onboarding_step").notNull().default("activate"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [index("app_profiles_role_idx").on(table.role)],
);

export const inviteCodes = sqliteTable(
  "invite_codes",
  {
    id: text("id").primaryKey(),
    codeDigest: text("code_digest").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    expiresAt: integer("expires_at"),
    note: text("note"),
    createdBy: text("created_by").references(() => esSystemAuthUser.id),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("invite_codes_digest_unique").on(table.codeDigest),
    index("invite_codes_status_expires_idx").on(table.status, table.expiresAt),
  ],
);

export const inviteRedemptions = sqliteTable(
  "invite_redemptions",
  {
    id: text("id").primaryKey(),
    inviteCodeId: text("invite_code_id")
      .notNull()
      .references(() => inviteCodes.id),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    redeemedAt: integer("redeemed_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("invite_redemptions_user_unique").on(table.userId),
    index("invite_redemptions_code_idx").on(table.inviteCodeId),
  ],
);

export const accessGrants = sqliteTable(
  "access_grants",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("invite_code"),
    grantedAt: integer("granted_at").notNull().default(nowMs),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [index("access_grants_status_idx").on(table.status)],
);

export const providerCredentials = sqliteTable(
  "provider_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    keyPrefix: text("key_prefix").notNull(),
    keyLast4: text("key_last4").notNull(),
    status: text("status").notNull().default("connected"),
    availablePoints: integer("available_points"),
    frozenPoints: integer("frozen_points"),
    verifiedAt: integer("verified_at").notNull(),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("provider_credentials_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
    index("provider_credentials_user_status_idx").on(table.userId, table.status),
  ],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    rawIdeas: text("raw_ideas").notNull().default(""),
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("projects_user_updated_idx").on(table.userId, table.updatedAt),
    index("projects_user_status_idx").on(table.userId, table.status),
  ],
);

export const scriptVersions = sqliteTable(
  "script_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    settingsJson: text("settings_json").notNull().default("{}"),
    source: text("source").notNull().default("deepseek"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [index("script_versions_project_created_idx").on(table.projectId, table.createdAt)],
);

export const scriptAnalyses = sqliteTable(
  "script_analyses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scriptVersionId: text("script_version_id")
      .notNull()
      .references(() => scriptVersions.id, { onDelete: "cascade" }),
    coreTitle: text("core_title").notNull(),
    alternativeTitlesJson: text("alternative_titles_json").notNull().default("[]"),
    coverSubtitle: text("cover_subtitle").notNull().default(""),
    keywordsJson: text("keywords_json").notNull().default("[]"),
    contentType: text("content_type").notNull().default("观点口播"),
    emotion: text("emotion").notNull().default("有力量"),
    animationPlanJson: text("animation_plan_json").notNull().default("[]"),
    confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("script_analyses_version_unique").on(table.scriptVersionId),
    index("script_analyses_project_updated_idx").on(table.projectId, table.updatedAt),
    index("script_analyses_user_idx").on(table.userId),
  ],
);

export const coverReferences = sqliteTable(
  "cover_references",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    objectPath: text("object_path").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull().default("uploading"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("cover_references_user_updated_idx").on(table.userId, table.updatedAt),
    index("cover_references_project_idx").on(table.projectId),
  ],
);

export const providerAssets = sqliteTable(
  "provider_assets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("chuanshenyun"),
    providerAssetId: text("provider_asset_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    sha256: text("sha256"),
    status: text("status").notNull(),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("provider_assets_user_provider_asset_unique").on(
      table.userId,
      table.provider,
      table.providerAssetId,
    ),
    index("provider_assets_user_kind_idx").on(table.userId, table.kind),
    index("provider_assets_user_hash_idx").on(table.userId, table.sha256),
  ],
);

export const voiceProfiles = sqliteTable(
  "voice_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    providerProfileId: text("provider_profile_id").notNull(),
    referenceAssetId: text("reference_asset_id").references(() => providerAssets.id),
    name: text("name").notNull(),
    promptText: text("prompt_text"),
    status: text("status").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("voice_profiles_user_provider_profile_unique").on(
      table.userId,
      table.providerProfileId,
    ),
    index("voice_profiles_user_status_idx").on(table.userId, table.status),
  ],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    name: text("name").notNull().default("未命名任务"),
    providerJobId: text("provider_job_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("created"),
    requestJson: text("request_json").notNull().default("{}"),
    resultJson: text("result_json").notNull().default("{}"),
    estimatedPoints: integer("estimated_points"),
    finalPoints: integer("final_points"),
    requestId: text("request_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    progress: integer("progress").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    uniqueIndex("generation_jobs_user_idempotency_unique").on(
      table.userId,
      table.idempotencyKey,
    ),
    index("generation_jobs_user_updated_idx").on(table.userId, table.updatedAt),
    index("generation_jobs_project_idx").on(table.projectId),
    index("generation_jobs_type_status_idx").on(table.type, table.status),
    index("generation_jobs_lease_idx").on(table.leaseExpiresAt),
  ],
);

export const videoOutputs = sqliteTable(
  "video_outputs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => esSystemAuthUser.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    generationJobId: text("generation_job_id")
      .notNull()
      .references(() => generationJobs.id, { onDelete: "cascade" }),
    providerAssetId: text("provider_asset_id"),
    providerExpiresAt: integer("provider_expires_at"),
    r2Uri: text("r2_uri"),
    status: text("status").notNull().default("available"),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("video_outputs_user_created_idx").on(table.userId, table.createdAt),
    uniqueIndex("video_outputs_job_unique").on(table.generationJobId),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => esSystemAuthUser.id),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    safeMetadataJson: text("safe_metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull().default(nowMs),
  },
  (table) => [
    index("audit_logs_actor_created_idx").on(table.actorUserId, table.createdAt),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
  ],
);

export const tutorialVideos = sqliteTable(
  "tutorial_videos",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull().default("新手教学"),
    description: text("description").notNull().default(""),
    objectPath: text("object_path").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    status: text("status").notNull().default("uploading"),
    uploadedBy: text("uploaded_by")
      .notNull()
      .references(() => esSystemAuthUser.id),
    createdAt: integer("created_at").notNull().default(nowMs),
    updatedAt: integer("updated_at").notNull().default(nowMs),
  },
  (table) => [
    index("tutorial_videos_status_updated_idx").on(table.status, table.updatedAt),
    index("tutorial_videos_uploader_idx").on(table.uploadedBy),
  ],
);
