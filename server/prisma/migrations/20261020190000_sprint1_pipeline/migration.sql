-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "applyPlatform" TEXT NOT NULL DEFAULT 'other',
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "filterReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "location" TEXT,
ADD COLUMN     "loopId" INTEGER,
ADD COLUMN     "postedAt" TIMESTAMP(3),
ADD COLUMN     "remote" BOOLEAN,
ADD COLUMN     "salaryCurrency" TEXT,
ADD COLUMN     "salaryMax" INTEGER,
ADD COLUMN     "salaryMin" INTEGER,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "stage" TEXT NOT NULL DEFAULT 'discovered',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "ResumeVariant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumeVersion" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "variantId" INTEGER,
    "tailored" JSONB NOT NULL,
    "pdfPath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "method" TEXT,
    "resumeVersionId" INTEGER,
    "resumeVariantId" INTEGER,
    "loopId" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "submitApprovedAt" TIMESTAMP(3),
    "submitLockedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "filledAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "screenshotPath" TEXT,
    "manualReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" SERIAL NOT NULL,
    "applicationId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "askedVia" TEXT,
    "answerId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Answer" (
    "id" SERIAL NOT NULL,
    "key" TEXT,
    "questionText" TEXT NOT NULL,
    "patterns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rawAnswer" TEXT NOT NULL,
    "polishedAnswer" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "reusable" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" SERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "jobId" INTEGER,
    "applicationId" INTEGER,
    "loopId" INTEGER,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramMessage" (
    "id" SERIAL NOT NULL,
    "direction" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "chatMessageId" INTEGER,
    "questionId" INTEGER,
    "applicationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loop" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "locations" TEXT[],
    "sources" TEXT[],
    "filters" JSONB NOT NULL DEFAULT '{}',
    "resumeVariantIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "schedule" TEXT NOT NULL DEFAULT '0 */6 * * *',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "salaryFloors" JSONB NOT NULL DEFAULT '{"INR":1200000,"USD":30000,"EUR":28000,"GBP":24000}',
    "noticeDays" INTEGER NOT NULL DEFAULT 60,
    "matchThreshold" INTEGER NOT NULL DEFAULT 65,
    "maxYearsRequired" INTEGER NOT NULL DEFAULT 2,
    "sources" JSONB NOT NULL DEFAULT '{}',
    "dailyCap" INTEGER NOT NULL DEFAULT 15,
    "maxScoresPerDay" INTEGER NOT NULL DEFAULT 60,
    "maxTailorsPerDay" INTEGER NOT NULL DEFAULT 20,
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "telegramChatId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceFetch" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL,

    CONSTRAINT "SourceFetch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResumeVariant_name_key" ON "ResumeVariant"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Application_jobId_key" ON "Application"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_idempotencyKey_key" ON "Application"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Question_status_idx" ON "Question"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Answer_key_key" ON "Answer"("key");

-- CreateIndex
CREATE INDEX "AgentAction_createdAt_idx" ON "AgentAction"("createdAt");

-- CreateIndex
CREATE INDEX "AgentAction_type_idx" ON "AgentAction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Loop_name_key" ON "Loop"("name");

-- CreateIndex
CREATE INDEX "SourceFetch_source_queryKey_fetchedAt_idx" ON "SourceFetch"("source", "queryKey", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_dedupeKey_key" ON "Job"("dedupeKey");

-- CreateIndex
CREATE INDEX "Job_stage_idx" ON "Job"("stage");

-- CreateIndex
CREATE INDEX "Job_loopId_idx" ON "Job"("loopId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "Loop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ResumeVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_resumeVariantId_fkey" FOREIGN KEY ("resumeVariantId") REFERENCES "ResumeVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "Loop"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "Answer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramMessage" ADD CONSTRAINT "TelegramMessage_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramMessage" ADD CONSTRAINT "TelegramMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Jobs scored before this migration
UPDATE "Job" SET "stage" = 'scored' WHERE "scoredAt" IS NOT NULL;
