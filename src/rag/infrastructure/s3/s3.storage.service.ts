import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3';
import { RAG_CONFIG, TRagConfig } from '../config/rag-config';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';

@Injectable()
export class S3StorageService implements OnModuleInit {
  private s3Client: S3Client | null = null;
  private readonly bucketName: string;
  private readonly publicUrl?: string;
  private readonly isEnabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    @Inject('LoggerPort') private readonly logger: LoggerPort,
  ) {
    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);

    this.bucketName = ragConfig?.s3BucketName || 'rag-images';
    this.publicUrl = ragConfig?.s3PublicUrl;

    // ✅ якщо немає конфіга — вимикаємо S3
    if (
      !ragConfig?.s3Endpoint ||
      !ragConfig?.s3AccessKey ||
      !ragConfig?.s3SecretKey
    ) {
      this.logger.warn('S3 is disabled (no config provided)');
      this.isEnabled = false;
      return;
    }

    this.isEnabled = true;

    this.s3Client = new S3Client({
      endpoint: ragConfig.s3Endpoint,
      region: ragConfig.s3Region || 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: ragConfig.s3AccessKey,
        secretAccessKey: ragConfig.s3SecretKey,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.isEnabled || !this.s3Client) return;

    await this.ensureBucketExists();
    this.logger.log(`S3 bucket "${this.bucketName}" is ready`);
  }

  private async ensureBucketExists(): Promise<void> {
    if (!this.s3Client) return;

    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
    } catch (error: any) {
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        this.logger.log(`Creating S3 bucket "${this.bucketName}"...`);
        await this.s3Client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
      } else {
        throw error;
      }
    }
  }

  async uploadFile(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    if (!this.isEnabled || !this.s3Client) {
      this.logger.warn('S3 upload skipped (disabled)');
      return '';
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return this.publicUrl
      ? `${this.publicUrl}/${this.bucketName}/${key}`
      : key;
  }

  async deleteFile(key: string): Promise<void> {
    if (!this.isEnabled || !this.s3Client) {
      this.logger.warn('S3 delete skipped (disabled)');
      return;
    }

    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }
}