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
    "spendGoal" REAL NOT NULL DEFAULT 0,
    "spendGoalText" TEXT NOT NULL DEFAULT 'Spend {amount} more to unlock free shipping!',
    "spendGoalDoneText" TEXT NOT NULL DEFAULT 'You''ve unlocked free shipping! 🎉',
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "giftProductId" TEXT,
    "giftVariantId" TEXT,
    "giftTitle" TEXT,
    "giftImageUrl" TEXT,
    "giftThreshold" REAL NOT NULL DEFAULT 0,
    "productSource" TEXT NOT NULL DEFAULT 'manual',
    "audience" TEXT NOT NULL DEFAULT 'all',
    "localizedCopyJson" TEXT NOT NULL DEFAULT '{}',
    "bgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "textColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "buttonColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "discountId" TEXT,
    "lastUpsellSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("audience", "bgColor", "blockTitle", "buttonColor", "buttonLabel", "createdAt", "discountId", "id", "lastUpsellSyncAt", "layout", "localizedCopyJson", "maxVisible", "minCartSubtotal", "plan", "productSource", "shop", "showImage", "showPrice", "textColor", "updatedAt") SELECT "audience", "bgColor", "blockTitle", "buttonColor", "buttonLabel", "createdAt", "discountId", "id", "lastUpsellSyncAt", "layout", "localizedCopyJson", "maxVisible", "minCartSubtotal", "plan", "productSource", "shop", "showImage", "showPrice", "textColor", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
