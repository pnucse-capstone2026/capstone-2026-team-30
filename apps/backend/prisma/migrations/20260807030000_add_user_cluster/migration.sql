CREATE TABLE "UserCluster" (
    "userId" TEXT NOT NULL,
    "clusterId" VARCHAR(128) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCluster_pkey" PRIMARY KEY ("userId","clusterId")
);

CREATE INDEX "UserCluster_clusterId_idx" ON "UserCluster"("clusterId");

ALTER TABLE "UserCluster" ADD CONSTRAINT "UserCluster_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
