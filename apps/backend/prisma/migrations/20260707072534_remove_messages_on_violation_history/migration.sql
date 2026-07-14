/*
  Warnings:

  - You are about to drop the column `parsedMessage` on the `ViolationHistory` table. All the data in the column will be lost.
  - You are about to drop the column `rawMessage` on the `ViolationHistory` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ViolationHistory" DROP COLUMN "parsedMessage",
DROP COLUMN "rawMessage";
