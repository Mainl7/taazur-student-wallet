CREATE TABLE `Canteen` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `canteenCode` VARCHAR(64) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `schoolId` VARCHAR(191) NOT NULL,
  `operatorId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `Canteen_canteenCode_key`(`canteenCode`),
  UNIQUE INDEX `Canteen_schoolId_name_key`(`schoolId`, `name`),
  INDEX `Canteen_schoolId_status_idx`(`schoolId`, `status`),
  INDEX `Canteen_operatorId_status_idx`(`operatorId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WalletTransaction` ADD COLUMN `canteenId` VARCHAR(191) NULL;
CREATE INDEX `WalletTransaction_canteenId_createdAt_idx` ON `WalletTransaction`(`canteenId`, `createdAt`);

ALTER TABLE `CanteenSettlement` ADD COLUMN `canteenId` VARCHAR(191) NULL;
CREATE INDEX `CanteenSettlement_canteenId_createdAt_idx` ON `CanteenSettlement`(`canteenId`, `createdAt`);

ALTER TABLE `Canteen` ADD CONSTRAINT `Canteen_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Canteen` ADD CONSTRAINT `Canteen_operatorId_fkey` FOREIGN KEY (`operatorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_canteenId_fkey` FOREIGN KEY (`canteenId`) REFERENCES `Canteen`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CanteenSettlement` ADD CONSTRAINT `CanteenSettlement_canteenId_fkey` FOREIGN KEY (`canteenId`) REFERENCES `Canteen`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
