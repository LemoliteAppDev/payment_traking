-- Manager-editable reminder timing: a house default plus per-EMI overrides.
-- NULL on a Reminder's sendHours/leadDays means "inherit the default", so
-- changing the default moves every inheriting row.
ALTER TABLE `Reminder` ADD COLUMN `sendHours` VARCHAR(191) NULL;
ALTER TABLE `Reminder` ADD COLUMN `leadDays` INTEGER NULL;

CREATE TABLE `ReminderSetting` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `sendHours` VARCHAR(191) NOT NULL DEFAULT '11,21',
    `leadDays` INTEGER NOT NULL DEFAULT 3,
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
);

-- Seed the singleton with the values that were previously hardcoded, so
-- behaviour is identical until somebody changes it.
INSERT INTO `ReminderSetting` (`id`, `sendHours`, `leadDays`, `updatedAt`)
VALUES ('default', '11,21', 3, NOW(3));
