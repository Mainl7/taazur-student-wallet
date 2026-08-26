CREATE TABLE `UserSession` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `ip` VARCHAR(191) NULL,
  `userAgent` VARCHAR(500) NULL,
  `revokedAt` DATETIME(3) NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `UserSession_userId_revokedAt_expiresAt_idx` ON `UserSession`(`userId`, `revokedAt`, `expiresAt`);

ALTER TABLE `UserSession`
  ADD CONSTRAINT `UserSession_userId_fkey`
  FOREIGN KEY (`userId`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;
