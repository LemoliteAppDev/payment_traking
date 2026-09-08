-- CreateTable: EMI reminders. Standalone from Payment — Jignesh adds them
-- (manually or from a sheet); Jignesh, Jagat and Mahesh get the reminders and
-- any of them can mark one paid.
CREATE TABLE `Reminder` (
    `id` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `amount` BIGINT NOT NULL,
    `dueDate` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'PAID') NOT NULL DEFAULT 'PENDING',
    `paidOn` DATETIME(3) NULL,
    `paidAt` DATETIME(3) NULL,
    `paidById` VARCHAR(191) NULL,
    `paidNote` TEXT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `lastRemindedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Reminder_status_dueDate_idx`(`status`, `dueDate`),
    INDEX `Reminder_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
);

ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_paidById_fkey` FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `Reminder` ADD CONSTRAINT `Reminder_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
