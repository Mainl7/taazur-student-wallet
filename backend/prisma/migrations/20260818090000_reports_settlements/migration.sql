CREATE TABLE `CanteenSettlement` (
  `id` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `canteenUserId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `transactionCount` INTEGER NOT NULL,
  `periodStart` DATETIME(3) NOT NULL,
  `periodEnd` DATETIME(3) NOT NULL,
  `note` VARCHAR(191) NULL,
  `settledById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `CanteenSettlement_canteenUserId_createdAt_idx`(`canteenUserId`, `createdAt`),
  INDEX `CanteenSettlement_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CanteenSettlement` ADD CONSTRAINT `CanteenSettlement_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CanteenSettlement` ADD CONSTRAINT `CanteenSettlement_canteenUserId_fkey` FOREIGN KEY (`canteenUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CanteenSettlement` ADD CONSTRAINT `CanteenSettlement_settledById_fkey` FOREIGN KEY (`settledById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
