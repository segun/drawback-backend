/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeSubscriptions1773500000000 implements MigrationInterface {
  name = 'NormalizeSubscriptions1773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create new subscriptions table (if it doesn't exist)
    const tableExists = await queryRunner.hasTable('subscriptions');

    if (!tableExists) {
      await queryRunner.query(
        `CREATE TABLE subscriptions (
          id VARCHAR(36) NOT NULL PRIMARY KEY,
          userId VARCHAR(36) NOT NULL,
          platform VARCHAR(20) NOT NULL,
          tier VARCHAR(20) NOT NULL,
          status VARCHAR(20) NOT NULL,
          startDate DATETIME NOT NULL,
          endDate DATETIME NOT NULL,
          autoRenew TINYINT NOT NULL DEFAULT 0,
          originalTransactionId VARCHAR(255) NULL,
          purchaseToken TEXT NOT NULL,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          UNIQUE INDEX IDX_subscriptions_userId (userId),
          INDEX idx_subscriptions_endDate (endDate),
          CONSTRAINT FK_subscriptions_user FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB`,
      );
    }

    // 2. Check if old subscription columns exist before migrating
    const columns = await queryRunner.query(
      `SELECT COLUMN_NAME 
       FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = 'users' 
       AND COLUMN_NAME = 'subscription_platform'`,
    );

    if (columns.length > 0) {
      // Migrate existing subscription data from users to subscriptions table
      await queryRunner.query(
        `INSERT INTO subscriptions 
          (id, userId, platform, tier, status, startDate, endDate, autoRenew, originalTransactionId, purchaseToken)
        SELECT 
          UUID() as id,
          id as userId,
          subscription_platform as platform,
          subscription_tier as tier,
          subscription_status as status,
          subscription_start_date as startDate,
          subscription_end_date as endDate,
          subscription_auto_renew as autoRenew,
          original_transaction_id,
          purchase_token
        FROM users 
        WHERE subscription_platform IS NOT NULL`,
      );

      // 3. Drop the old subscription columns from users table
      // Check if index exists before dropping it
      const indexes = await queryRunner.query(
        `SHOW INDEX FROM users WHERE Key_name = 'idx_users_subscription_end'`,
      );
      if (indexes && indexes.length > 0) {
        await queryRunner.query(
          `DROP INDEX idx_users_subscription_end ON users`,
        );
      }

      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_platform`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_tier`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_status`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_start_date`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_end_date`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN subscription_auto_renew`,
      );
      await queryRunner.query(
        `ALTER TABLE users DROP COLUMN original_transaction_id`,
      );
      await queryRunner.query(`ALTER TABLE users DROP COLUMN purchase_token`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Re-add subscription columns to users table
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionPlatform VARCHAR(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionTier VARCHAR(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionStatus VARCHAR(20) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionStartDate DATETIME NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionEndDate DATETIME NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscriptionAutoRenew TINYINT DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN originalTransactionId VARCHAR(255) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN purchaseToken TEXT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_users_subscription_end ON users(subscriptionEndDate)`,
    );

    // 2. Migrate data back from subscriptions to users
    await queryRunner.query(
      `UPDATE users u 
       INNER JOIN subscriptions s ON u.id = s.userId
       SET 
         u.subscriptionPlatform = s.platform,
         u.subscriptionTier = s.tier,
         u.subscriptionStatus = s.status,
         u.subscriptionStartDate = s.startDate,
         u.subscriptionEndDate = s.endDate,
         u.subscriptionAutoRenew = s.autoRenew,
         u.originalTransactionId = s.originalTransactionId,
         u.purchaseToken = s.purchaseToken`,
    );

    // 3. Drop subscriptions table
    await queryRunner.query(`DROP TABLE subscriptions`);
  }
}
