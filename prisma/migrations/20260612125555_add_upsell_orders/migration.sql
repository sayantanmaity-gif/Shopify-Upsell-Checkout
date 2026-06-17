-- CreateTable
CREATE TABLE "UpsellOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "currencyCode" TEXT,
    "upsellTotal" REAL NOT NULL DEFAULT 0,
    "upsellUnits" INTEGER NOT NULL DEFAULT 0,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "UpsellOrder_shop_idx" ON "UpsellOrder"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "UpsellOrder_shop_orderId_key" ON "UpsellOrder"("shop", "orderId");
