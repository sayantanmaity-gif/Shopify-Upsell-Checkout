-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "blockTitle" TEXT NOT NULL DEFAULT 'You might also like',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Add to order',
    "layout" TEXT NOT NULL DEFAULT 'single',
    "showImage" BOOLEAN NOT NULL DEFAULT true,
    "showPrice" BOOLEAN NOT NULL DEFAULT true,
    "maxVisible" INTEGER NOT NULL DEFAULT 3,
    "minCartSubtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spendGoal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spendGoalText" TEXT NOT NULL DEFAULT 'Spend {amount} more to unlock free shipping!',
    "spendGoalDoneText" TEXT NOT NULL DEFAULT 'You''ve unlocked free shipping! 🎉',
    "lowStockThreshold" INTEGER NOT NULL DEFAULT 0,
    "holdoutPercent" INTEGER NOT NULL DEFAULT 0,
    "giftProductId" TEXT,
    "giftVariantId" TEXT,
    "giftTitle" TEXT,
    "giftImageUrl" TEXT,
    "giftThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "productSource" TEXT NOT NULL DEFAULT 'manual',
    "audience" TEXT NOT NULL DEFAULT 'all',
    "localizedCopyJson" TEXT NOT NULL DEFAULT '{}',
    "bgColor" TEXT NOT NULL DEFAULT '#ffffff',
    "textColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "buttonColor" TEXT NOT NULL DEFAULT '#1a1a1a',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "discountId" TEXT,
    "lastUpsellSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "currencyCode" TEXT,
    "upsellTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "upsellUnits" INTEGER NOT NULL DEFAULT 0,
    "orderTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "itemsJson" TEXT NOT NULL DEFAULT '[]',
    "orderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStat" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'treatment',
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hadUpsell" BOOLEAN NOT NULL DEFAULT false,
    "orderedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellProduct" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "imageUrl" TEXT,
    "price" TEXT,
    "discountType" TEXT,
    "discountValue" DOUBLE PRECISION,
    "volumeMinQty" INTEGER,
    "volumeValue" DOUBLE PRECISION,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpsellProduct_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE INDEX "UpsellOrder_shop_idx" ON "UpsellOrder"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "UpsellOrder_shop_orderId_key" ON "UpsellOrder"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OrderStat_shop_idx" ON "OrderStat"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderStat_shop_orderId_key" ON "OrderStat"("shop", "orderId");

-- CreateIndex
CREATE INDEX "UpsellProduct_shop_idx" ON "UpsellProduct"("shop");

-- AddForeignKey
ALTER TABLE "UpsellProduct" ADD CONSTRAINT "UpsellProduct_shop_fkey" FOREIGN KEY ("shop") REFERENCES "ShopSettings"("shop") ON DELETE CASCADE ON UPDATE CASCADE;
