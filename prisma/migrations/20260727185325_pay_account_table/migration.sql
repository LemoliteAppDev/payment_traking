-- CreateTable: the admin-managed "Pay from" list.
CREATE TABLE `PayAccount` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PayAccount_name_key`(`name`),
    PRIMARY KEY (`id`)
);

-- AlterTable: payFrom moves from an enum to a plain string (account name).
-- Existing rows currently hold the enum codes ('PELISWAN', ...) — preserved by the MODIFY.
ALTER TABLE `Payment` MODIFY `payFrom` VARCHAR(191) NOT NULL;

-- Data migration: map the old enum codes to their display names.
UPDATE `Payment` SET `payFrom` = 'Peliswan' WHERE `payFrom` = 'PELISWAN';
UPDATE `Payment` SET `payFrom` = 'Lemolite' WHERE `payFrom` = 'LEMOLITE';
UPDATE `Payment` SET `payFrom` = 'Shivam'   WHERE `payFrom` = 'SHIVAM';
UPDATE `Payment` SET `payFrom` = 'Zenith'   WHERE `payFrom` = 'ZENITH';

-- Seed the four accounts that were previously hard-coded.
INSERT INTO `PayAccount` (`id`, `name`, `active`, `createdAt`) VALUES
    ('payacc_seed_peliswan', 'Peliswan', true, CURRENT_TIMESTAMP(3)),
    ('payacc_seed_lemolite', 'Lemolite', true, CURRENT_TIMESTAMP(3)),
    ('payacc_seed_shivam',   'Shivam',   true, CURRENT_TIMESTAMP(3)),
    ('payacc_seed_zenith',   'Zenith',   true, CURRENT_TIMESTAMP(3));
