import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.from = config.get<string>('MAIL_FROM', 'noreply@drawback.app');
    this.appUrl = config.get<string>('APP_URL', 'http://localhost:3000');

    this.transporter = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST', 'localhost'),
      port: config.get<number>('SMTP_PORT', 587),
      secure: config.get<string>('SMTP_SECURE', 'false') === 'true',
      auth: {
        user: config.get<string>('SMTP_USER', ''),
        pass: config.get<string>('SMTP_PASS', ''),
      },
    });
  }

  async sendActivationEmail(email: string, token: string): Promise<void> {
    const confirmUrl = `${this.appUrl}/auth/confirm/${token}`;

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: 'Confirm your Drawback account',
        text: `Click the link to activate your account: ${confirmUrl}`,
        html: `
          <p>Welcome to Drawback!</p>
          <p>Click the link below to activate your account:</p>
          <a href="${confirmUrl}">${confirmUrl}</a>
          <p>If you did not register, you can ignore this email.</p>
        `,
      });
    } catch (err) {
      this.logger.error(`Failed to send activation email to ${email}`, err);
      throw err;
    }
  }
}
