-- Add a source type to distinguish company pay-from accounts from
-- Jagat-managed individual members.
CREATE TABLE `PrivateMember` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PrivateMember_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Payment` ADD COLUMN `payFromType` ENUM('ACCOUNT', 'INDIVIDUAL') NOT NULL DEFAULT 'ACCOUNT';
