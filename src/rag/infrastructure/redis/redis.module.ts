import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from '@upstash/redis'

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          url: config.get<string>('REDIS_HOST') ,
          token: config.get<string>('REDIS_TOKEN'),
        })
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}