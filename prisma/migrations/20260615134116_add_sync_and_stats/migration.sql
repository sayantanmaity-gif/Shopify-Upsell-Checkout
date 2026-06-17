-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN "lastUpsellSyncAt" DATETIME;

-- CreateTable
CREATE TABLE "UpsellStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "adds" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE INDEX "UpsellStat_shop_idx" ON "UpsellStat"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "UpsellStat_shop_day_key" ON "UpsellStat"("shop", "day");
