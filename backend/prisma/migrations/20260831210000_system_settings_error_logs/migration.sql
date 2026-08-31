CREATE TABLE `SystemSetting` (
  `id` VARCHAR(191) NOT NULL,
  `key` VARCHAR(80) NOT NULL,
  `value` JSON NOT NULL,
  `updatedById` VARCHAR(191) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `SystemSetting_key_key`(`key`),
  INDEX `SystemSetting_updatedAt_idx`(`updatedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ErrorLog` (
  `id` VARCHAR(191) NOT NULL,
  `requestId` VARCHAR(64) NOT NULL,
  `method` VARCHAR(12) NOT NULL,
  `path` VARCHAR(300) NOT NULL,
  `statusCode` INTEGER NOT NULL,
  `error` VARCHAR(120) NOT NULL,
  `message` VARCHAR(500) NULL,
  `userId` VARCHAR(191) NULL,
  `schoolId` VARCHAR(191) NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(500) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `resolvedAt` DATETIME(3) NULL,
  UNIQUE INDEX `ErrorLog_requestId_key`(`requestId`),
  INDEX `ErrorLog_createdAt_idx`(`createdAt`),
  INDEX `ErrorLog_statusCode_createdAt_idx`(`statusCode`, `createdAt`),
  INDEX `ErrorLog_schoolId_createdAt_idx`(`schoolId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
