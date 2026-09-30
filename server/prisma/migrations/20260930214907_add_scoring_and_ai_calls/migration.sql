-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "matchScore" INTEGER,
ADD COLUMN     "matchedSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "missingSkills" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "redFlags" JSONB,
ADD COLUMN     "scoredAt" TIMESTAMP(3),
ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "AiCall" (
    "id" SERIAL NOT NULL,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "jobId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
