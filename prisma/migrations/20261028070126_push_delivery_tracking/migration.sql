-- AlterTable
ALTER TABLE `PushSubscription` ADD COLUMN `device` VARCHAR(120) NULL,
    ADD COLUMN `failureCount` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastError` VARCHAR(180) NULL,
    ADD COLUMN `lastFailureAt` DATETIME(3) NULL,
    ADD COLUMN `lastSuccessAt` DATETIME(3) NULL;
