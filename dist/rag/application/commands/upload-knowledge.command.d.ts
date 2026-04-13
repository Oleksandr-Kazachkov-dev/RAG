import { IUploadedFile } from "../../domain/interfaces/upload-folder.interface";
export interface UploadKnowledgeOptions {
    chunkingStrategy?: 'simple' | 'semantic' | 'parent-child';
    enableKnowledgeGraph?: boolean;
}
export declare class UploadKnowledgeCommand {
    readonly file: IUploadedFile;
    readonly options?: UploadKnowledgeOptions | undefined;
    constructor(file: IUploadedFile, options?: UploadKnowledgeOptions | undefined);
}
