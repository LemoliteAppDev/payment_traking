-- Private approver<->payer payments.
ALTER TABLE `Payment` ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false;

-- Pay-from display priority.
ALTER TABLE `PayAccount` ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0;

-- Seed the priority the team asked for; anything else falls to the bottom.
UPDATE `PayAccount` SET `sortOrder` = CASE LOWER(`name`)
    WHEN 'shivam'       THEN 1
    WHEN 'peliswan'     THEN 2
    WHEN 'bm roadlines' THEN 3
    WHEN 'zenith'       THEN 4
    WHEN 'lemolite'     THEN 5
    WHEN 'shakti'       THEN 6
    ELSE 100 END;
