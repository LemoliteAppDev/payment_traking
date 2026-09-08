-- Per-person reminder timing: each of the three can want a different amount of
-- warning for the same EMI.
CREATE TABLE `ReminderPreference` (
    `userId` VARCHAR(191) NOT NULL,
    `sendHours` VARCHAR(191) NULL,
    `leadDays` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`userId`)
);

-- De-duplication has to be per person now. With one shared
-- Reminder.lastRemindedAt, reminding Jignesh at 4 days out would suppress
-- Mahesh's own reminder two days later.
CREATE TABLE `ReminderNotification` (
    `id` VARCHAR(191) NOT NULL,
    `reminderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `sentAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ReminderNotification_reminderId_userId_key`(`reminderId`, `userId`),
    INDEX `ReminderNotification_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
);

ALTER TABLE `ReminderPreference` ADD CONSTRAINT `ReminderPreference_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReminderNotification` ADD CONSTRAINT `ReminderNotification_reminderId_fkey` FOREIGN KEY (`reminderId`) REFERENCES `Reminder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ReminderNotification` ADD CONSTRAINT `ReminderNotification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
