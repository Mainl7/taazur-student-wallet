CREATE TABLE `User` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(191) NOT NULL,
  `role` ENUM('SUPER_ADMIN', 'ASSOCIATION_ADMIN', 'SCHOOL_ADMIN', 'CANTEEN_OPERATOR', 'AUDITOR') NOT NULL,
  `schoolId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `User_email_key`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `School` (
  `id` VARCHAR(191) NOT NULL,
  `schoolCode` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `city` VARCHAR(191) NOT NULL,
  `district` VARCHAR(191) NULL,
  `address` VARCHAR(191) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `School_schoolCode_key`(`schoolCode`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Student` (
  `id` VARCHAR(191) NOT NULL,
  `studentCode` VARCHAR(191) NOT NULL,
  `fullName` VARCHAR(191) NOT NULL,
  `grade` VARCHAR(191) NOT NULL,
  `className` VARCHAR(191) NULL,
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `dailyLimit` DECIMAL(12, 2) NOT NULL,
  `weeklyLimit` DECIMAL(12, 2) NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Student_studentCode_key`(`studentCode`),
  INDEX `Student_schoolId_status_idx`(`schoolId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Card` (
  `id` VARCHAR(191) NOT NULL,
  `publicToken` VARCHAR(128) NOT NULL,
  `status` ENUM('ACTIVE', 'REVOKED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  `studentId` VARCHAR(191) NOT NULL,
  `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NULL,
  `revokedAt` DATETIME(3) NULL,
  UNIQUE INDEX `Card_publicToken_key`(`publicToken`),
  INDEX `Card_studentId_status_idx`(`studentId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Wallet` (
  `id` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `balance` DECIMAL(12, 2) NOT NULL DEFAULT 0,
  `currency` VARCHAR(3) NOT NULL DEFAULT 'SAR',
  `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `Wallet_studentId_key`(`studentId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WalletTransaction` (
  `id` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NULL,
  `walletId` VARCHAR(191) NOT NULL,
  `studentId` VARCHAR(191) NOT NULL,
  `schoolId` VARCHAR(191) NOT NULL,
  `amount` DECIMAL(12, 2) NOT NULL,
  `type` ENUM('CREDIT', 'DEBIT', 'REFUND', 'REVERSAL', 'ADJUSTMENT') NOT NULL,
  `balanceBefore` DECIMAL(12, 2) NOT NULL,
  `balanceAfter` DECIMAL(12, 2) NOT NULL,
  `performedById` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `WalletTransaction_reference_key`(`reference`),
  UNIQUE INDEX `WalletTransaction_idempotencyKey_key`(`idempotencyKey`),
  INDEX `WalletTransaction_studentId_createdAt_idx`(`studentId`, `createdAt`),
  INDEX `WalletTransaction_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuditLog` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NULL,
  `action` VARCHAR(191) NOT NULL,
  `entity` VARCHAR(191) NOT NULL,
  `entityId` VARCHAR(191) NOT NULL,
  `oldValue` JSON NULL,
  `newValue` JSON NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(191) NULL,
  `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `User` ADD CONSTRAINT `User_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Student` ADD CONSTRAINT `Student_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Card` ADD CONSTRAINT `Card_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Wallet` ADD CONSTRAINT `Wallet_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `Student`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_walletId_fkey` FOREIGN KEY (`walletId`) REFERENCES `Wallet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `WalletTransaction` ADD CONSTRAINT `WalletTransaction_performedById_fkey` FOREIGN KEY (`performedById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
