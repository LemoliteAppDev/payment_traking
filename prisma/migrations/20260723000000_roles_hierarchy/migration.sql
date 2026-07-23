-- Payment: additive status values + approval columns
ALTER TABLE `Payment` ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    MODIFY `status` ENUM('AWAITING_APPROVAL', 'RETURNED', 'REQUESTED', 'SCHEDULED', 'PAID', 'CONFIRMED', 'HOLD', 'CANCELLED') NOT NULL DEFAULT 'REQUESTED';

-- PaymentEvent: additive event types
ALTER TABLE `PaymentEvent` MODIFY `type` ENUM('REQUEST', 'APPROVE', 'RETURN', 'RESUBMIT', 'EDIT', 'SCHEDULE', 'PAY', 'CONFIRM', 'HOLD', 'CANCEL', 'NUDGE', 'REMINDER', 'NOTE') NOT NULL;

-- Role enum: data-safe transition (widen -> remap existing users to ADMIN -> narrow)
ALTER TABLE `User` MODIFY `role` ENUM('PAYER', 'REQUESTER', 'ADMIN', 'USER') NOT NULL;
UPDATE `User` SET `role` = 'ADMIN' WHERE `role` IN ('PAYER', 'REQUESTER');

-- User: add capability flags + narrow role to final set
ALTER TABLE `User` ADD COLUMN `active` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `isApprover` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isManager` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `isPayer` BOOLEAN NOT NULL DEFAULT false,
    MODIFY `role` ENUM('ADMIN', 'USER') NOT NULL;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
