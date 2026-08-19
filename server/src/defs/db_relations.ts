import { relations } from "drizzle-orm";
import { esSystemAuthUser } from "../__generated__/sys_schema";
import {
  accessGrants,
  appProfiles,
  coverReferences,
  generationJobs,
  inviteCodes,
  inviteRedemptions,
  projects,
  providerAssets,
  providerCredentials,
  scriptVersions,
  scriptAnalyses,
  videoOutputs,
  voiceProfiles,
} from "./db_schema";

export const authUserAppRelations = relations(esSystemAuthUser, ({ one, many }) => ({
  profile: one(appProfiles),
  accessGrant: one(accessGrants),
  providerCredentials: many(providerCredentials),
  projects: many(projects),
  assets: many(providerAssets),
  voiceProfiles: many(voiceProfiles),
  generationJobs: many(generationJobs),
  coverReferences: many(coverReferences),
  scriptAnalyses: many(scriptAnalyses),
}));

export const inviteCodesRelations = relations(inviteCodes, ({ many }) => ({
  redemptions: many(inviteRedemptions),
}));

export const inviteRedemptionsRelations = relations(inviteRedemptions, ({ one }) => ({
  inviteCode: one(inviteCodes, {
    fields: [inviteRedemptions.inviteCodeId],
    references: [inviteCodes.id],
  }),
  user: one(esSystemAuthUser, {
    fields: [inviteRedemptions.userId],
    references: [esSystemAuthUser.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(esSystemAuthUser, {
    fields: [projects.userId],
    references: [esSystemAuthUser.id],
  }),
  scripts: many(scriptVersions),
  analyses: many(scriptAnalyses),
  coverReferences: many(coverReferences),
  jobs: many(generationJobs),
  outputs: many(videoOutputs),
}));

export const scriptVersionsRelations = relations(scriptVersions, ({ one }) => ({
  project: one(projects, {
    fields: [scriptVersions.projectId],
    references: [projects.id],
  }),
}));

export const scriptAnalysesRelations = relations(scriptAnalyses, ({ one }) => ({
  user: one(esSystemAuthUser, {
    fields: [scriptAnalyses.userId],
    references: [esSystemAuthUser.id],
  }),
  project: one(projects, {
    fields: [scriptAnalyses.projectId],
    references: [projects.id],
  }),
  scriptVersion: one(scriptVersions, {
    fields: [scriptAnalyses.scriptVersionId],
    references: [scriptVersions.id],
  }),
}));

export const coverReferencesRelations = relations(coverReferences, ({ one }) => ({
  user: one(esSystemAuthUser, {
    fields: [coverReferences.userId],
    references: [esSystemAuthUser.id],
  }),
  project: one(projects, {
    fields: [coverReferences.projectId],
    references: [projects.id],
  }),
}));

export const voiceProfilesRelations = relations(voiceProfiles, ({ one }) => ({
  referenceAsset: one(providerAssets, {
    fields: [voiceProfiles.referenceAssetId],
    references: [providerAssets.id],
  }),
}));

export const generationJobsRelations = relations(generationJobs, ({ one }) => ({
  project: one(projects, {
    fields: [generationJobs.projectId],
    references: [projects.id],
  }),
}));

export const videoOutputsRelations = relations(videoOutputs, ({ one }) => ({
  project: one(projects, {
    fields: [videoOutputs.projectId],
    references: [projects.id],
  }),
  job: one(generationJobs, {
    fields: [videoOutputs.generationJobId],
    references: [generationJobs.id],
  }),
}));
