ALTER TABLE `User` ADD COLUMN `status` ENUM('ACTIVE', 'INACTIVE', 'SUSPENDED') NOT NULL DEFAULT 'ACTIVE';

ALTER TABLE `AuditLog` ADD COLUMN `schoolId` VARCHAR(191) NULL;
CREATE INDEX `AuditLog_schoolId_timestamp_idx` ON `AuditLog`(`schoolId`, `timestamp`);
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_schoolId_fkey` FOREIGN KEY (`schoolId`) REFERENCES `School`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `LoginAttempt` (
  `id` VARCHAR(191) NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `failedCount` INTEGER NOT NULL DEFAULT 0,
  `lockedUntil` DATETIME(3) NULL,
  `lastAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `LoginAttempt_email_key`(`email`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
