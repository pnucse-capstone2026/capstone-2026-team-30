-- AlterTable
ALTER TABLE "User" ADD COLUMN "currentSessionId" TEXT;

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('ACTIVE', 'RESOLVED_BY_EXCEPTION', 'RESOLVED_BY_HOTFIX', 'IGNORED');

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(253) NOT NULL,
    "message" VARCHAR(2000) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(50) NOT NULL,
    "href" VARCHAR(512) NOT NULL,
    "targetRoles" "Role"[],
    "targetUserEmails" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationRead" (
    "userId" TEXT NOT NULL,
    "notificationId" VARCHAR(128) NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationRead_pkey" PRIMARY KEY ("userId","notificationId")
);

-- CreateTable
CREATE TABLE "DeploymentIncident" (
    "id" TEXT NOT NULL,
    "clusterId" VARCHAR(128) NOT NULL,
    "namespace" VARCHAR(63) NOT NULL,
    "resourceKind" VARCHAR(63) NOT NULL,
    "resourceName" VARCHAR(253) NOT NULL,
    "policyName" VARCHAR(253) NOT NULL,
    "ruleName" VARCHAR(253),
    "blockReason" TEXT NOT NULL,
    "gitopsAppName" VARCHAR(253),
    "gitCommitSha" VARCHAR(64),
    "gitRepository" VARCHAR(512),
    "status" "IncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "blockCount" INTEGER NOT NULL DEFAULT 1,
    "firstBlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "exceptionId" VARCHAR(128),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeploymentIncident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE INDEX "NotificationRead_userId_idx" ON "NotificationRead"("userId");

-- CreateIndex
CREATE INDEX "DeploymentIncident_clusterId_status_idx" ON "DeploymentIncident"("clusterId", "status");

-- CreateIndex
CREATE INDEX "DeploymentIncident_clusterId_namespace_status_idx" ON "DeploymentIncident"("clusterId", "namespace", "status");

-- CreateIndex
CREATE INDEX "DeploymentIncident_status_lastBlockedAt_idx" ON "DeploymentIncident"("status", "lastBlockedAt");

-- CreateIndex
CREATE INDEX "DeploymentIncident_gitopsAppName_idx" ON "DeploymentIncident"("gitopsAppName");

-- AddForeignKey
ALTER TABLE "NotificationRead" ADD CONSTRAINT "NotificationRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
