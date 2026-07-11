-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'APPROVER', 'REQUESTER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "pwdHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViolationHistory" (
    "id" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "parsedMessage" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ViolationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyExceptionRequest" (
    "id" TEXT NOT NULL,
    "status" "ExceptionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "policyName" TEXT NOT NULL,
    "k8sExceptionName" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "requestUserId" TEXT NOT NULL,
    "approverUserId" TEXT NOT NULL,

    CONSTRAINT "PolicyExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ViolationHistory_policyName_idx" ON "ViolationHistory"("policyName");

-- CreateIndex
CREATE INDEX "ViolationHistory_occurredAt_idx" ON "ViolationHistory"("occurredAt");

-- CreateIndex
CREATE INDEX "PolicyExceptionRequest_status_idx" ON "PolicyExceptionRequest"("status");

-- CreateIndex
CREATE INDEX "PolicyExceptionRequest_policyName_idx" ON "PolicyExceptionRequest"("policyName");

-- CreateIndex
CREATE INDEX "PolicyExceptionRequest_requestUserId_idx" ON "PolicyExceptionRequest"("requestUserId");

-- CreateIndex
CREATE INDEX "PolicyExceptionRequest_approverUserId_idx" ON "PolicyExceptionRequest"("approverUserId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "PolicyExceptionRequest" ADD CONSTRAINT "PolicyExceptionRequest_requestUserId_fkey" FOREIGN KEY ("requestUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyExceptionRequest" ADD CONSTRAINT "PolicyExceptionRequest_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
