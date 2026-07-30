-- CreateTable: secure per-payment OTP thread (approver <-> payer).
CREATE TABLE `OtpMessage` (
    `id` VARCHAR(191) NOT NULL,
    `paymentId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `OtpMessage_paymentId_idx`(`paymentId`),
    PRIMARY KEY (`id`)
);

ALTER TABLE `OtpMessage` ADD CONSTRAINT `OtpMessage_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `Payment`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `OtpMessage` ADD CONSTRAINT `OtpMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
