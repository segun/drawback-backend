import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSubscriptionFields1773400000000 implements MigrationInterface {
  name = 'AddSubscriptionFields1773400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_platform VARCHAR(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_status VARCHAR(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_start_date TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_end_date TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN subscription_auto_renew BOOLEAN DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN original_transaction_id VARCHAR(255)`,
    );
    await queryRunner.query(`ALTER TABLE users ADD COLUMN purchase_token TEXT`);
    await queryRunner.query(
      `CREATE INDEX idx_users_subscription_end ON users(subscription_end_date)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_users_subscription_end ON users`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN purchase_token`);
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN original_transaction_id`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN subscription_auto_renew`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN subscription_end_date`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN subscription_start_date`,
    );
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN subscription_status`,
    );
    await queryRunner.query(`ALTER TABLE users DROP COLUMN subscription_tier`);
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN subscription_platform`,
    );
  }
}
