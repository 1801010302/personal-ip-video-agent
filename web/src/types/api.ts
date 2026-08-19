export interface ApiErrorBody {
  ok: false;
  error: {
    code: string;
    message?: string;
    requestId?: string | null;
  };
}

export interface AccessStatus {
  activated: boolean;
  accessStatus: string;
  accessSource: string | null;
  accessExpiresAt: number | null;
  role: "user" | "admin";
  deepseekConnected: boolean;
  deepseekStatus: string;
  providerConnected: boolean;
  providerStatus: string;
  imagegenConnected: boolean;
  imagegenStatus: string;
}

export interface InviteCodeRecord {
  id: string;
  label: string;
  status: "active" | "disabled";
  maxUses: number | null;
  usedCount: number;
  expiresAt: number | null;
  createdAt: number;
}

export interface TutorialVideo {
  id: string;
  title: string;
  description: string;
  contentType: "video/mp4" | "video/webm";
  sizeBytes: number;
  durationMs: number | null;
  status: "active";
  playbackUrl: string;
  createdAt: number;
  updatedAt: number;
}

export interface CoverReferenceRecord {
  id: string;
  projectId: string | null;
  filename: string;
  contentType: string;
  sizeBytes: number;
  status: "ready";
  previewUrl: string;
  previewExpiresAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AdminOperations {
  generatedAt: number;
  metrics: {
    totalUsers: number;
    todayUsers: number;
    activeAccessUsers: number;
    invitedUsers: number;
    paidUsers: number;
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    activeJobs: number;
    todayJobs: number;
    todayFailedJobs: number;
    sevenDayJobs: number;
    sevenDaySuccessRate: number;
    packagingQueuedJobs: number;
    packagingProcessingJobs: number;
    coverQueuedJobs: number;
    coverProcessingJobs: number;
    digitalHumanActiveJobs: number;
    oldestQueuedAt: number | null;
  };
  daily: Array<{ date: string; users: number; jobs: number; completed: number; failed: number }>;
  users: Array<{
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    role: string;
    createdAt: number;
    lastLoginAt: number | null;
    accessStatus: string;
    accessSource: string | null;
    accessExpiresAt: number | null;
    providers: Array<{ provider: string; status: string; verifiedAt: number }>;
    projectCount: number;
    jobCount: number;
    completedJobCount: number;
    failedJobCount: number;
    activeJobCount: number;
    lastJobAt: number | null;
  }>;
  jobs: Array<{
    id: string;
    userId: string;
    userEmail: string | null;
    projectId: string | null;
    projectTitle: string | null;
    name: string;
    type: string;
    status: string;
    progress: number;
    providerJobId: string | null;
    requestId: string | null;
    estimatedPoints: number | null;
    finalPoints: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: number;
    updatedAt: number;
    terminal: boolean;
  }>;
}

export interface ProviderConnection {
  connected: boolean;
  status: string;
  maskedKey?: string;
  availablePoints?: number | null;
  frozenPoints?: number | null;
  verifiedAt?: number;
  models?: string[];
}

export interface AnnualPlan {
  code: string;
  name: string;
  amountFen: number;
  currency: "CNY";
  billingCycle: "year";
  inviteAccessFree: boolean;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ScriptVersion {
  id: string;
  projectId: string;
  content: string;
  source: "deepseek" | "manual";
  settingsJson: string;
  settings?: Record<string, unknown>;
  createdAt: number;
}

export interface AnimationCue {
  id: string;
  triggerText: string;
  type: "keyword" | "number" | "list" | "warning" | "quote" | "cta";
  headline: string;
  detail: string;
  intensity: "low" | "medium" | "high";
}

export interface ScriptAnalysis {
  id: string;
  projectId: string;
  scriptVersionId: string;
  coreTitle: string;
  coverSubtitle: string;
  contentType: string;
  emotion: string;
  confirmed: boolean;
  alternativeTitles: string[];
  keywords: string[];
  animationPlan: AnimationCue[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectRecord {
  id: string;
  title: string;
  rawIdeas: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  latestScript?: ScriptVersion | null;
  jobCount?: number;
  latestJobStatus?: string | null;
}

export interface ProviderAsset {
  id: string;
  providerAssetId: string;
  kind: "audio" | "template";
  name: string;
  status: string;
  metadata: Record<string, unknown>;
  origin: "user_upload" | "voice_clone" | "unknown";
  durationMs: number | null;
  width: number | null;
  height: number | null;
  previewUrl: string | null;
  errorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface VoiceProfile {
  id: string;
  providerProfileId: string;
  referenceAssetId: string | null;
  name: string;
  promptText: string | null;
  status: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GenerationJob {
  id: string;
  projectId: string | null;
  type: "voice_clone" | "digital_human" | "video_packaging" | "cover_image";
  name: string;
  providerJobId: string | null;
  status: string;
  estimatedPoints: number | null;
  finalPoints: number | null;
  request: Record<string, unknown>;
  result: Record<string, unknown>;
  outputStatus?: string | null;
  expiresAt?: number | null;
  downloadAvailable?: boolean;
  errorMessage: string | null;
  progress: number;
  createdAt: number;
  updatedAt: number;
}
