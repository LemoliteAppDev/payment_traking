-- Monthly EMIs: every row generated from one "repeats monthly" entry shares a
-- seriesId, so the whole run can be cancelled in one go.
ALTER TABLE `Reminder` ADD COLUMN `seriesId` VARCHAR(191) NULL;
CREATE INDEX `Reminder_seriesId_idx` ON `Reminder`(`seriesId`);
