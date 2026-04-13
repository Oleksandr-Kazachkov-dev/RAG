import { OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerPort } from "../../shared/application/ports/logger.port";
export declare class S3StorageService implements OnModuleInit {
    private readonly configService;
    private readonly logger;
    private s3Client;
    private readonly bucketName;
    private readonly publicUrl?;
    private readonly isEnabled;
    constructor(configService: ConfigService, logger: LoggerPort);
    onModuleInit(): Promise<void>;
    private ensureBucketExists;
    uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string>;
    deleteFile(key: string): Promise<void>;
}
