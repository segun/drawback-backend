import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';
import * as path from 'path';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    this.from = this.require('MAIL_FROM');
    this.appUrl = this.require('APP_URL');

    this.transporter = nodemailer.createTransport({
      host: this.require('SMTP_HOST'),
      port: Number(this.require('SMTP_PORT')),
      secure: this.require('SMTP_SECURE') === 'true',
      auth: {
        user: this.require('SMTP_USER'),
        pass: this.require('SMTP_PASSWORD'),
      },
    });
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }

  private renderTemplate(
    templatePath: string,
    variables: Record<string, string>,
  ): string {
    let html = fs.readFileSync(templatePath, 'utf8');
    for (const [key, value] of Object.entries(variables)) {
      html = html.replaceAll(`{{${key}}}`, value);
    }
    return html;
  }

  async sendActivationEmail(
    email: string,
    token: string,
    displayName: string,
  ): Promise<void> {
    const confirmUrl = `${this.config.get<string>('EMAIL_CONFIRM_URL')}/${token}`;
    const appName = this.config.get<string>('APP_NAME') ?? 'Drawback';
    const supportEmail = this.config.get<string>('MAIL_SUPPORT') ?? this.from;
    const logoUrl = this.config.get<string>('APP_LOGO_URL') ?? '';
    const expiresInHours =
      this.config.get<string>('ACTIVATION_EXPIRES_HOURS') ?? '24';

    const templatePath = path.join(
      __dirname,
      '..',
      'auth',
      'public',
      'registration-welcome.html',
    );

    const html = this.renderTemplate(templatePath, {
      appName,
      logoUrl,
      displayName,
      email,
      confirmationUrl: confirmUrl,
      expiresInHours,
      supportEmail,
      year: new Date().getFullYear().toString(),
    });

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: email,
        subject: `Welcome to ${appName} — confirm your email`,
        text: `Hi ${displayName}, click the link to activate your account: ${confirmUrl} (expires in ${expiresInHours} hours)`,
        html,
      });
    } catch (err) {
      this.logger.error(`Failed to send activation email to ${email}`, err);
      throw err;
    }
  }
}
