import { Module } from '@nestjs/common';
import { RagModule } from './rag/rag.module';
import { ConfigModule } from '@nestjs/config';
import { ragConfig } from './rag/infrastructure/config/rag-config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    RagModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [ragConfig],
    }),
    ThrottlerModule.forRoot([
      {
        limit: 20,
        ttl: 3600
      },
    ]),
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}