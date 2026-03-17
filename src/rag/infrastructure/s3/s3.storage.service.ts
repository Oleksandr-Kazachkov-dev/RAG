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
  private readonly s3Client: S3Client;
  private readonly bucketName: string;
  private readonly publicUrl?: string;

  constructor(
    private readonly configService: ConfigService,
    @Inject('LoggerPort') private readonly logger: LoggerPort,
  ) {
    const ragConfig = this.configService.get<TRagConfig>(RAG_CONFIG);

    this.bucketName = ragConfig?.s3BucketName || 'rag-images';
    this.publicUrl = ragConfig?.s3PublicUrl;

    const endpoint = ragConfig?.s3Endpoint || 'http://localhost:9000';
    if (ragConfig?.s3Endpoint) {
      return;
    }
    const region = ragConfig?.s3Region || 'us-east-1';
    const useSsl = ragConfig?.s3UseSsl || false;

    if (!ragConfig?.s3AccessKey || !ragConfig?.s3SecretKey) {
      throw new Error(
        'S3_ACCESS_KEY and S3_SECRET_KEY must be set in environment variables. ' +
          'Server startup aborted for security reasons. ' +
          'Please configure these values in your .env file.',
      );
    }

    this.s3Client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ragConfig.s3AccessKey,
        secretAccessKey: ragConfig.s3SecretKey,
      },
      ...(useSsl ? {} : { tls: false }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
    this.logger.log(`S3 bucket "${this.bucketName}" is ready`);
  }

  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
    } catch (error) {
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
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return `${this.publicUrl}/${this.bucketName}/${key}`;
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      }),
    );
  }
}