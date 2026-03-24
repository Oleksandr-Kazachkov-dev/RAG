import { Injectable } from '@nestjs/common';
import {
  IKnowledgeLink,
  IKnowledgeLinkRepository,
  LinkType,
} from 'src/rag/domain/interfaces/knowledge-link.interface';
import { PrismaService } from 'src/rag/infrastructure/prisma/prisma.service';

@Injectable()
export class KnowledgeLinkPrismaRepository implements IKnowledgeLinkRepository {

  constructor(private readonly prisma: PrismaService) {}

  async upsertMany(
    links: Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>[],
  ): Promise<number> {
    if (!links.length) return 0;

    let saved = 0;
    for (const link of links) {
      await (this.prisma as any).knowledgeLink.upsert({
        where: { id: '00000000-0000-0000-0000-000000000000' },
        update: {},
        create: {
          url:        link.url,
          label:      link.label,
          context:    link.context,
          sourceFile: link.sourceFile,
          linkType:   link.linkType,
          keywords:   link.keywords,
        },
      }).catch(() =>
        (this.prisma as any).knowledgeLink.create({
          data: {
            url:        link.url,
            label:      link.label,
            context:    link.context,
            sourceFile: link.sourceFile,
            linkType:   link.linkType,
            keywords:   link.keywords,
          },
        }),
      );
      saved++;
    }
    return saved;
  }

  async findByKeywords(keywords: string[]): Promise<IKnowledgeLink[]> {
    if (!keywords.length) return [];

    const rows = await (this.prisma as any).$queryRaw`
      SELECT * FROM knowledge_links
      WHERE keywords && ${keywords}::text[]
      ORDER BY created_at DESC
      LIMIT 20
    `;
    return (rows as any[]).map(this.toInterface);
  }

  async findAll(): Promise<IKnowledgeLink[]> {
    const rows = await (this.prisma as any).knowledgeLink.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(this.toInterface);
  }

  async deleteBySourceFile(sourceFile: string): Promise<void> {
    await (this.prisma as any).knowledgeLink.deleteMany({
      where: { sourceFile },
    });
  }

  private toInterface(row: any): IKnowledgeLink {
    return {
      id:         row.id,
      url:        row.url,
      label:      row.label,
      context:    row.context,
      sourceFile: row.sourceFile ?? row.source_file,
      linkType:   (row.linkType ?? row.link_type) as LinkType,
      keywords:   row.keywords ?? [],
      createdAt:  new Date(row.createdAt ?? row.created_at),
      updatedAt:  new Date(row.updatedAt ?? row.updated_at),
    };
  }
}
