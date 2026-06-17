/*
  Warnings:

  - You are about to drop the `UpsellStat` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "UpsellOrder" ADD COLUMN "orderedAt" DATETIME;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "UpsellStat";
PRAGMA foreign_keys=on;
