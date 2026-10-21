-- AlterTable
ALTER TABLE "ResumeVersion" ADD COLUMN     "instruction" TEXT,
ADD COLUMN     "parentId" INTEGER;

-- CreateTable
CREATE TABLE "ResumeChatMessage" (
    "id" SERIAL NOT NULL,
    "jobId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "resumeVersionId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResumeChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeChatMessage_jobId_idx" ON "ResumeChatMessage"("jobId");

-- AddForeignKey
ALTER TABLE "ResumeVersion" ADD CONSTRAINT "ResumeVersion_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeChatMessage" ADD CONSTRAINT "ResumeChatMessage_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumeChatMessage" ADD CONSTRAINT "ResumeChatMessage_resumeVersionId_fkey" FOREIGN KEY ("resumeVersionId") REFERENCES "ResumeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

