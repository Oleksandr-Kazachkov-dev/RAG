import { LoggerPort } from "../../shared/application/ports/logger.port";
import { DeleteImageCommand } from '../commands/delete-image.command';
import { IDeleteImage } from '../common/interfaces/image.interfaces';
import { ImageRagPort } from "../../domain/ports/image-rag.port";
export declare class DeleteImageHandler {
    private readonly imageRag;
    private readonly logger;
    constructor(imageRag: ImageRagPort, logger: LoggerPort);
    execute(cmd: DeleteImageCommand): Promise<IDeleteImage>;
}
