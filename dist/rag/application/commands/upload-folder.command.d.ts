import { IUploadedFile } from "../../domain/interfaces/upload-folder.interface";
export interface UploadFolderOptions {
    chunkingStrategy?: 'simple' | 'semantic' | 'parent-child';
    enableKnowledgeGraph?: boolean;
    parentChild?: {
        parentSize?: number;
        childSize?: number;
        overlap?: number;
        storeParentText?: boolean;
        useMarkdownHeaders?: boolean;
    };
}
export declare class UploadFolderCommand {
    readonly files: IUploadedFile[];
    readonly options?: UploadFolderOptions | undefined;
    constructor(files: IUploadedFile[], options?: UploadFolderOptions | undefined);
}
