export type LinkType = 'url' | 'image' | 'video';

export interface IKnowledgeLink {
  id:         string;
  url:        string;
  label:      string;
  context:    string;
  sourceFile: string;
  linkType:   LinkType;
  keywords:   string[];
  createdAt:  Date;
  updatedAt:  Date;
}

export interface IKnowledgeLinkRepository {
  upsertMany(links: Omit<IKnowledgeLink, 'id' | 'createdAt' | 'updatedAt'>[]): Promise<number>;
  findByKeywords(keywords: string[]): Promise<IKnowledgeLink[]>;
  findAll(): Promise<IKnowledgeLink[]>;
  deleteBySourceFile(sourceFile: string): Promise<void>;
}
