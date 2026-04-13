import { LoggerPort } from "../../shared/application/ports/logger.port";
import { ProcessImagesCommand } from '../commands/process-images.command';
import { IUploadImage } from '../common/interfaces/image.interfaces';
import { ImageRagPort } from "../../domain/ports/image-rag.port";
export declare class ProcessImagesHandler {
    private readonly imageRag;
    private readonly logger;
    constructor(imageRag: ImageRagPort, logger: LoggerPort);
    execute(cmd: ProcessImagesCommand): Promise<IUploadImage>;
}
