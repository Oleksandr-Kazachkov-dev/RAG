import {
  Controller,
  Get,
  Delete,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
  Inject,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { LinkService, LinkSearchResult } from '../../application/services/link.service';
import { IKnowledgeLink, IKnowledgeLinkRepository } from '../../domain/interfaces/knowledge-link.interface';
import { LoggerPort } from '../../shared/application/ports/logger.port';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ExtractLinksHandler } from 'src/rag/application/handlers/extract-links.handler';
import { IndexLinksCommand } from 'src/rag/application/commands/extract-links.command';

export interface GetAllLinksResponse {
  total: number;
  links: IKnowledgeLink[];
}

export interface SearchLinksResponse {
  query:  string;
  total:  number;
  links:  IKnowledgeLink[];
  block?: string;
}

export interface DeleteLinksResponse {
  sourceFile: string;
  deleted:    boolean;
}

export interface IndexLinksResponse {
    filesProcessed: number;
    linksIndexed:   number;
  }  


const mdFilesInterceptor = () =>
    FilesInterceptor('files', 200, {
      storage: memoryStorage(),
      fileFilter: (_req, file, cb) => {
        if (file.originalname.endsWith('.md')) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
    });

@Controller('links')
export class LinksController {
  constructor(
    private readonly linkService: LinkService,
    @Inject('IKnowledgeLinkRepository')
    private readonly repo: IKnowledgeLinkRepository,
    @Inject('LoggerPort')
    private readonly logger: LoggerPort,
    private readonly handler: ExtractLinksHandler,
  ) {}

  @Get()
  async getAllLinks(
    @Query('sourceFile') sourceFile?: string,
  ): Promise<GetAllLinksResponse> {
    let links = await this.repo.findAll();

    if (sourceFile) {
      links = links.filter(l => l.sourceFile === sourceFile);
    }

    this.logger.log('LinksController.getAllLinks', {
      sourceFile: sourceFile ?? 'all',
      total: links.length,
    });

    return { total: links.length, links };
  }

  @Get('search')
  async searchLinks(
    @Query('q') q?: string,
  ): Promise<SearchLinksResponse> {
    if (!q || !q.trim()) {
      throw new BadRequestException('Query param "q" is required');
    }

    const result: LinkSearchResult = await this.linkService.findLinksForContext(q.trim());

    this.logger.log('LinksController.searchLinks', {
      q,
      found: result.found,
      total: result.links.length,
    });

    return {
      query: q.trim(),
      total: result.links.length,
      links: result.links,
      block: result.block,
    };
  }

  @Get('query')
  async queryLinks(
    @Query('q') q?: string,
  ): Promise<SearchLinksResponse> {
    if (!q || !q.trim()) {
      throw new BadRequestException('Query param "q" is required');
    }

    const result: LinkSearchResult = await this.linkService.findLinksForQuery(q.trim());

    if (!result.found) {
      throw new NotFoundException(
        'Query does not appear to be link-related. Use /links/search for keyword lookup.',
      );
    }

    this.logger.log('LinksController.queryLinks', {
      q,
      total: result.links.length,
    });

    return {
      query: q.trim(),
      total: result.links.length,
      links: result.links,
      block: result.block,
    };
  }

  @Delete(':sourceFile')
  @HttpCode(HttpStatus.OK)
  async deleteBySourceFile(
    @Param('sourceFile') sourceFile: string,
  ): Promise<DeleteLinksResponse> {
    if (!sourceFile || !sourceFile.trim()) {
      throw new BadRequestException('sourceFile param is required');
    }

    await this.repo.deleteBySourceFile(sourceFile.trim());

    this.logger.log('LinksController.deleteBySourceFile', { sourceFile });

    return { sourceFile: sourceFile.trim(), deleted: true };
  }

  @Post('index-links')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(mdFilesInterceptor())
  async indexLinks(
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<IndexLinksResponse> {
    if (!files || files.length === 0) {
      throw new BadRequestException(
        'No .md files received. Send files under the "files" multipart field.',
      );
    }

    this.logger.log('UploadFolderController: indexLinks received', {
      files: files.map(f => f.originalname),
    });

    return this.handler.execute(new IndexLinksCommand(files));
  }
}
  