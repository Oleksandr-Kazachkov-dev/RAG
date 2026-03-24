import { IKnowledgeLink, LinkType } from 'src/rag/domain/interfaces/knowledge-link.interface';
export interface ExtractedLink {
    url: string;
    label: string;
    context: string;
    linkType: LinkType;
    keywords: string[];
}
export declare function extractLinksFromMarkdown(content: string, sourceFile: string): Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>[];
export declare function isLinkQuery(query: string): boolean;
