"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const swagger_1 = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const all_exeption_filter_1 = require("./rag/shared/nest/filters/all-exeption.filter");
const helmet_1 = require("helmet");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.use((0, helmet_1.default)());
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    app.useGlobalFilters(new all_exeption_filter_1.AllExceptionsFilter());
    const server = app.getHttpServer();
    server.setTimeout(0);
    server.keepAliveTimeout = 0;
    server.headersTimeout = 0;
    const allowedOrigins = process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : [];
    if (process.env.NODE_ENV === 'production' && allowedOrigins.length === 0) {
        throw new Error('ALLOWED_ORIGINS must be set in production environment. ' +
            'Example: ALLOWED_ORIGINS=https://your-frontend.com,https://staging.your-frontend.com');
    }
    app.enableCors({
        origin: process.env.NODE_ENV === 'development'
            ? true
            : allowedOrigins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    });
    if (process.env.NODE_ENV !== 'production') {
        const config = new swagger_1.DocumentBuilder()
            .setTitle('RAG Demo API')
            .setDescription('Demo API for Retrieval-Augmented Generation')
            .setVersion('1.0')
            .build();
        const document = swagger_1.SwaggerModule.createDocument(app, config);
        swagger_1.SwaggerModule.setup('api', app, document);
    }
    await app.listen(3000);
    console.log('RAG demo running on http://localhost:3000');
    console.log('Swagger UI: http://localhost:3000/api');
}
bootstrap();
//# sourceMappingURL=main.js.map