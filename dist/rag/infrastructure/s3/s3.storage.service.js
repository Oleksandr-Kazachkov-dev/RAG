"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3StorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const client_s3_1 = require("@aws-sdk/client-s3");
const rag_config_1 = require("../config/rag-config");
let S3StorageService = class S3StorageService {
    constructor(configService, logger) {
        this.configService = configService;
        this.logger = logger;
        this.s3Client = null;
        const ragConfig = this.configService.get(rag_config_1.RAG_CONFIG);
        this.bucketName = ragConfig?.s3BucketName || 'rag-images';
        this.publicUrl = ragConfig?.s3PublicUrl;
        console.log('ragConfig :>> ', ragConfig);
        if (!ragConfig?.s3Endpoint ||
            !ragConfig?.s3AccessKey ||
            !ragConfig?.s3SecretKey) {
            this.logger.warn('S3 is disabled (no config provided)');
            this.isEnabled = false;
            console.log('hre');
            return;
        }
        this.isEnabled = true;
        this.s3Client = new client_s3_1.S3Client({
            endpoint: ragConfig.s3Endpoint,
            region: ragConfig.s3Region || 'us-east-1',
            forcePathStyle: true,
            credentials: {
                accessKeyId: ragConfig.s3AccessKey,
                secretAccessKey: ragConfig.s3SecretKey,
            },
        });
    }
    async onModuleInit() {
        if (!this.isEnabled || !this.s3Client)
            return;
        await this.ensureBucketExists();
        this.logger.log(`S3 bucket "${this.bucketName}" is ready`);
    }
    async ensureBucketExists() {
        if (!this.s3Client)
            return;
        try {
            await this.s3Client.send(new client_s3_1.HeadBucketCommand({ Bucket: this.bucketName }));
        }
        catch (error) {
            if (error.name === 'NotFound' ||
                error.$metadata?.httpStatusCode === 404) {
                this.logger.log(`Creating S3 bucket "${this.bucketName}"...`);
                await this.s3Client.send(new client_s3_1.CreateBucketCommand({ Bucket: this.bucketName }));
            }
            else {
                throw error;
            }
        }
    }
    async uploadFile(key, buffer, contentType) {
        if (!this.isEnabled || !this.s3Client) {
            this.logger.warn('S3 upload skipped (disabled)');
            return '';
        }
        await this.s3Client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        }));
        return this.publicUrl
            ? `${this.publicUrl}/${this.bucketName}/${key}`
            : key;
    }
    async deleteFile(key) {
        if (!this.isEnabled || !this.s3Client) {
            this.logger.warn('S3 delete skipped (disabled)');
            return;
        }
        await this.s3Client.send(new client_s3_1.DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        }));
    }
};
exports.S3StorageService = S3StorageService;
exports.S3StorageService = S3StorageService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)('LoggerPort')),
    __metadata("design:paramtypes", [config_1.ConfigService, Object])
], S3StorageService);
//# sourceMappingURL=s3.storage.service.js.map