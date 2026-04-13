import { LoggerPort } from "../../shared/application/ports/logger.port";
import { IImageWithoutScore } from '../common/interfaces/image.interfaces';
import { ImageRagPort } from "../../domain/ports/image-rag.port";
import { GetAllImagesCommand } from '../commands/get-all-images.command';
export declare class GetAllImagesHandler {
    private readonly imageRag;
    private readonly logger;
    constructor(imageRag: ImageRagPort, logger: LoggerPort);
    execute(cmd: GetAllImagesCommand): Promise<Array<IImageWithoutScore>>;
}
