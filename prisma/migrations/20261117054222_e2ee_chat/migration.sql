-- CreateTable
CREATE TABLE `ChatDevice` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(120) NULL,
    `publicKey` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatDevice_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatThread` (
    `id` VARCHAR(191) NOT NULL,
    `aId` VARCHAR(191) NOT NULL,
    `bId` VARCHAR(191) NOT NULL,
    `lastMessageAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ChatThread_lastMessageAt_idx`(`lastMessageAt`),
    UNIQUE INDEX `ChatThread_aId_bId_key`(`aId`, `bId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatMessage` (
    `id` VARCHAR(191) NOT NULL,
    `threadId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `senderDeviceId` VARCHAR(191) NOT NULL,
    `kind` ENUM('TEXT', 'IMAGE', 'FILE', 'AUDIO') NOT NULL DEFAULT 'TEXT',
    `body` TEXT NOT NULL,
    `iv` VARCHAR(64) NOT NULL,
    `storedName` VARCHAR(191) NULL,
    `mediaMeta` TEXT NULL,
    `mediaIv` VARCHAR(64) NULL,
    `mediaSize` INTEGER NULL,
    `durationMs` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `ChatMessage_storedName_key`(`storedName`),
    INDEX `ChatMessage_threadId_createdAt_idx`(`threadId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatEnvelope` (
    `id` VARCHAR(191) NOT NULL,
    `messageId` VARCHAR(191) NOT NULL,
    `deviceId` VARCHAR(191) NOT NULL,
    `wrappedKey` TEXT NOT NULL,
    `iv` VARCHAR(64) NOT NULL,
    `ephemeral` TEXT NOT NULL,

    INDEX `ChatEnvelope_deviceId_idx`(`deviceId`),
    UNIQUE INDEX `ChatEnvelope_messageId_deviceId_key`(`messageId`, `deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChatRead` (
    `threadId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `readAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`threadId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ChatDevice` ADD CONSTRAINT `ChatDevice_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatThread` ADD CONSTRAINT `ChatThread_aId_fkey` FOREIGN KEY (`aId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatThread` ADD CONSTRAINT `ChatThread_bId_fkey` FOREIGN KEY (`bId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `ChatThread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_senderId_fkey` FOREIGN KEY (`senderId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatMessage` ADD CONSTRAINT `ChatMessage_senderDeviceId_fkey` FOREIGN KEY (`senderDeviceId`) REFERENCES `ChatDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatEnvelope` ADD CONSTRAINT `ChatEnvelope_messageId_fkey` FOREIGN KEY (`messageId`) REFERENCES `ChatMessage`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatEnvelope` ADD CONSTRAINT `ChatEnvelope_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `ChatDevice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatRead` ADD CONSTRAINT `ChatRead_threadId_fkey` FOREIGN KEY (`threadId`) REFERENCES `ChatThread`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChatRead` ADD CONSTRAINT `ChatRead_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
