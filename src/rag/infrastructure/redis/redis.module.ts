import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis as RedisUpstash } from '@upstash/redis';
import IORedis from 'ioredis';
@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService): RedisUpstash | IORedis => {
        const token = config.get<string>('REDIS_TOKEN');

        if (token) {
          return new RedisUpstash({
            url: config.get<string>('REDIS_HOST'),
            token,
          });
        }

        return new IORedis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD'),
          db: config.get<number>('REDIS_DB', 0),
          keyPrefix: 'rag:',
          lazyConnect: true,
          retryStrategy: (times) => Math.min(times * 200, 5000),
        });
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}