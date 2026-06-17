-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "blockTitle" TEXT NOT NULL DEFAULT 'You might also like',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Add to order',
    "layout" TEXT NOT NULL DEFAULT 'single',
    "showImage" BOOLEAN NOT NULL DEFAULT true,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "maxVisible" INTEGER NOT NULL DEFAULT 3,
    "minCartSubtotal" REAL NOT NULL DEFAULT 0,
    "bgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "textColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "buttonColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "discountId" TEXT,
    "lastUpsellSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("bgColor", "blockTitle", "buttonColor", "buttonLabel", "createdAt", "discountId", "id", "lastUpsellSyncAt", "layout", "maxVisible", "plan", "shop", "showImage", "showPrice", "textColor", "updatedAt") SELECT "bgColor", "blockTitle", "buttonColor", "buttonLabel", "createdAt", "discountId", "id", "lastUpsellSyncAt", "layout", "maxVisible", "plan", "shop", "showImage", "showPrice", "textColor", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
