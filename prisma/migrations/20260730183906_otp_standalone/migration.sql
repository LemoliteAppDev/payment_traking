-- Make the OTP thread standalone: paymentId becomes optional (null = the global
-- approver <-> payer channel, not tied to any payment).
ALTER TABLE `OtpMessage` DROP FOREIGN KEY `OtpMessage_paymentId_fkey`;
ALTER TABLE `OtpMessage` MODIFY `paymentId` VARCHAR(191) NULL;
ALTER TABLE `OtpMessage` ADD CONSTRAINT `OtpMessage_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
