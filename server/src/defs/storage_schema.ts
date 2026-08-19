import type { BucketDef } from "@sdk/server-types";

export const outputs: BucketDef<"outputs"> = {
  bucket_name: "outputs",
  description: "Private completed user videos with automatic 7-day retention",
};

export const tutorials: BucketDef<"tutorials"> = {
  bucket_name: "tutorials",
  description: "Private onboarding tutorial videos uploaded by administrators",
};

export const staging: BucketDef<"staging"> = {
  bucket_name: "staging",
  description: "Temporary private staging for provider media uploads",
};

export const coverInputs: BucketDef<"cover-inputs"> = {
  bucket_name: "cover-inputs",
  description: "Private user portrait references for AI cover generation",
};
