import { Inject, Injectable } from '@nestjs/common';
import { LoggerPort } from 'src/rag/shared/application/ports/logger.port';
import { LinkService } from '../services/link.service';
import { IndexLinksCommand } from '../commands/extract-links.command';

@Injectable()
export class ExtractLinksHandler {
  constructor(
    @Inject('LoggerPort')  private readonly logger: LoggerPort,
    private readonly linkService: LinkService,
  ) {}

  async execute(
    command: IndexLinksCommand,
  ): Promise<{ filesProcessed: number; linksIndexed: number }> {
    const { files } = command;
  
    this.logger.log('UploadFolder:indexLinksOnly', { files: files.length });
  
    const result = await this.linkService.indexLinksFromFiles(
      files.map(f => ({
        originalname: f.originalname,
        buffer: Buffer.isBuffer(f.buffer) ? f.buffer : Buffer.from(f.buffer),
      })),
    );
  
    this.logger.log('UploadFolder:indexLinksOnly complete', result);
  
    return result;
  }
}
