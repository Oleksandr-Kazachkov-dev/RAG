import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Res,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

import { CommandBusPort } from '../../shared/application/ports/command-bus.port';
import { AskQuestionCommand } from '../../application/commands/ask-question.command';
import { AskQuestionHandler } from '../../application/handlers/ask-question.handler';
import { UploadKnowledgeCommand } from '../../application/commands/upload-knowledge.command';
import { DeleteDocumentCommand } from '../../application/commands/delete-document.command';

import {
  GetAllDocumentsQuery,
  RetrieveDocumentsQuery,
} from '../../application/queries/rag.queries';

import { ApiResponse } from '../api-response/api-response';
import { Meta } from '../api-response/meta';
import { AskDto } from '../dto/ask.dto';
import { UploadFolderCommand } from 'src/rag/application/commands/upload-folder.command';
import { IGenerateAnswer, IUploadKnowledge, IDocumentWithoutEmbedding, IDocumentWithEmbedding } from 'src/rag/application/common/interfaces/rag-documents.interfaces';
import { IUploadedFile } from 'src/rag/domain/interfaces/upload-folder.interface';
import { RetrieveDto } from '../dto/retrieve.dto';
import { UploadFolderDto } from '../dto/upload-folder.dto';

@Controller('rag/documents')
export class RagDocumentsController {
  constructor(
    @Inject('CommandBus') private readonly commandBus: CommandBusPort,
    private readonly askQuestionHandler: AskQuestionHandler,
  ) {}

  @Post('ask')
  async askQuestion(
    @Body() dto: AskDto,
  ): Promise<ApiResponse<IGenerateAnswer>> {
    const command = new AskQuestionCommand(dto.question, {
      limit:                    dto.limit,
      scoreThreshold:           dto.scoreThreshold,
      useHybridSearch:          dto.options?.useHybridSearch,
      useReranking:             dto.options?.useReranking,
      rerankStrategy:           dto.rerankStrategy,
      useQueryTransformation:   dto.options?.useQueryTransformation,
      useContextualCompression: dto.options?.useContextualCompression,
      useConversationMemory:    dto.options?.useConversationMemory,
      useCitationTracking:      dto.options?.useCitationTracking,
      useKnowledgeGraph:        dto.options?.useKnowledgeGraph,
      temperature:              dto.temperature,
      topP:                     dto.topP,
      topK:                     dto.topK,
      maxTokens:                dto.maxTokens,
      includeSources:           dto.includeSources,
      sessionId:                dto.options?.sessionId,
      conversationHistory:      dto.conversationHistory,
    });

    const answer = await this.commandBus.execute<IGenerateAnswer>(command);

    return ApiResponse.success(
      answer,
      new Meta({ message: 'Answer generated successfully' }),
    );
  }

  @Post('ask/stream')
  async askQuestionStream(
    @Body() dto: AskDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Content-Encoding', 'none');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const command = new AskQuestionCommand(dto.question, {
      limit:                    dto.limit,
      scoreThreshold:           dto.scoreThreshold,
      useHybridSearch:          dto.options?.useHybridSearch,
      useReranking:             dto.options?.useReranking,
      rerankStrategy:           dto.rerankStrategy,
      useQueryTransformation:   dto.options?.useQueryTransformation,
      useContextualCompression: dto.options?.useContextualCompression,
      useConversationMemory:    dto.options?.useConversationMemory,
      useCitationTracking:      dto.options?.useCitationTracking,
      useKnowledgeGraph:        dto.options?.useKnowledgeGraph,
      temperature:              dto.temperature,
      topP:                     dto.topP,
      topK:                     dto.topK,
      maxTokens:                dto.maxTokens,
      includeSources:           dto.includeSources,
      sessionId:                dto.options?.sessionId,
      conversationHistory:      dto.conversationHistory,
    });

    const writeChunk = (chunk: object, eventName: string): void => {
      res.write(`event: ${eventName}\ndata: ${JSON.stringify(chunk)}\n\n`);
      (res as any).flush?.();
    };

    try {
      for await (const chunk of this.askQuestionHandler.streamableExecute(command)) {
        writeChunk(chunk, chunk.event);

        if (chunk.event === 'done' || chunk.event === 'error') break;
      }
    } catch (err) {
      writeChunk({ event: 'error', error: (err as Error).message }, 'error');
    } finally {
      res.end();
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body('chunkingStrategy') chunkingStrategy?: 'simple' | 'semantic' | 'parent-child',
    @Body('enableKnowledgeGraph') enableKnowledgeGraph?: string,
  ): Promise<ApiResponse<IUploadKnowledge>> {
    const domainFile: IUploadedFile = {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      destination: file.destination,
      filename: file.filename,
      path: file.path,
      fieldname: file.fieldname,
      encoding: file.encoding,
      stream: file.stream,
    };

    const result = await this.commandBus.execute<IUploadKnowledge>(
      new UploadKnowledgeCommand(domainFile, {
        chunkingStrategy: chunkingStrategy ?? 'simple',
        enableKnowledgeGraph: enableKnowledgeGraph === 'true',
      }),
    );

    return ApiResponse.success(
      result,
      new Meta({
        message: `Document uploaded successfully with ${chunkingStrategy ?? 'simple'} chunking.`,
      }),
    );
  }

  @Get()
  async getAllDocuments(): Promise<ApiResponse<Array<IDocumentWithoutEmbedding>>> {
    const documents = await this.commandBus.execute<Array<IDocumentWithoutEmbedding>>(
      new GetAllDocumentsQuery(),
    );
    return ApiResponse.success(
      documents,
      new Meta({ message: 'Documents retrieved successfully', count: documents.length }),
    );
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.commandBus.execute(new DeleteDocumentCommand(id));
    return ApiResponse.success(null, new Meta({ message: 'Document deleted successfully' }));
  }

  @Post('upload-folder')
  @UseInterceptors(
    FilesInterceptor('files', 2500, {
      preservePath: true,
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadFolder(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() dto: UploadFolderDto,
  ): Promise<ApiResponse<unknown>> {
    const mdFiles = files.filter((f) => f.originalname.toLowerCase().endsWith('.md'));

    if (mdFiles.length === 0) {
      return ApiResponse.error('No markdown files found in upload');
    }

    const domainFiles: IUploadedFile[] = mdFiles.map((f) => ({
      fieldname: f.fieldname,
      originalname: f.originalname,
      encoding: f.encoding,
      mimetype: f.mimetype,
      size: f.size,
      destination: f.destination ?? '',
      filename: f.filename ?? '',
      path: f.path ?? '',
      buffer: f.buffer,
      stream: f.stream,
    }));

    const result = await this.commandBus.execute<{ totalChunks: number; filesProcessed: number }>(
      new UploadFolderCommand(domainFiles, {
        chunkingStrategy: dto.chunkingStrategy ?? 'simple',
        enableKnowledgeGraph: dto.enableKnowledgeGraph === 'true',
      }),
    );

    return ApiResponse.success(
      result,
      new Meta({
        message: `Processed ${result.filesProcessed} files with ${dto.chunkingStrategy ?? 'simple'} chunking.`,
      }),
    );
  }

  @Post('retrieve')
  async retrieve(@Body() dto: RetrieveDto): Promise<ApiResponse<IDocumentWithEmbedding[]>> {
    const results = await this.commandBus.execute<IDocumentWithEmbedding[]>(
      new RetrieveDocumentsQuery(dto.query, dto.options?.limit, dto.options),
    );
    return ApiResponse.success(
      results,
      new Meta({ message: `Retrieved ${results.length} relevant documents` }),
    );
  }
}