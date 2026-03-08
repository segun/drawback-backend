import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly maxFileSize = 5 * 1024 * 1024; // 5 MB

  constructor(private readonly config: ConfigService) {
    const accountId = this.require('CLOUDFLARE_R2_ACCOUNT_ID');
    const accessKeyId = this.require('CLOUDFLARE_R2_ACCESS_KEY_ID');
    const secretAccessKey = this.require('CLOUDFLARE_R2_SECRET_ACCESS_KEY');
    this.bucket = this.require('CLOUDFLARE_R2_BUCKET');
    this.publicBaseUrl = this.require('CLOUDFLARE_R2_PUBLIC_BASE_URL');

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
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

  private validateBase64Image(base64Data: string): void {
    // Check if it's a valid PNG data URI
    if (!base64Data.startsWith('data:image/png;base64,')) {
      throw new BadRequestException(
        'Invalid image format. Only PNG images are supported.',
      );
    }

    // Extract base64 string without the data URI prefix
    const base64String = base64Data.split(',')[1];
    if (!base64String) {
      throw new BadRequestException('Invalid base64 data.');
    }

    // Calculate size (base64 is ~4/3 the size of original)
    const sizeInBytes = (base64String.length * 3) / 4;
    if (sizeInBytes > this.maxFileSize) {
      throw new BadRequestException(
        `Image size exceeds maximum allowed size of ${this.maxFileSize / (1024 * 1024)} MB.`,
      );
    }
  }

  async uploadDiscoveryImage(
    userId: string,
    base64Data: string,
  ): Promise<string> {
    this.validateBase64Image(base64Data);

    // Extract base64 string without the data URI prefix
    const base64String = base64Data.split(',')[1];
    const buffer = Buffer.from(base64String, 'base64');

    const key = `drawback/discovery-drawings/${userId}.png`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
    });

    try {
      await this.s3Client.send(command);
    } catch (err) {
      const error = err as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      throw new BadRequestException(
        `Failed to upload image to R2: ${error.name || error.Code || 'Unknown error'}. ` +
          `Please check your Cloudflare R2 credentials and bucket permissions.`,
      );
    }

    return `${this.publicBaseUrl}/${key}`;
  }

  async deleteDiscoveryImage(userId: string): Promise<void> {
    const key = `drawback/discovery-drawings/${userId}.png`;

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      await this.s3Client.send(command);
    } catch (err) {
      // Swallow 404 errors - file might already be deleted
      const error = err as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        error.name !== 'NoSuchKey' &&
        error.$metadata?.httpStatusCode !== 404
      ) {
        throw err;
      }
    }
  }
}
