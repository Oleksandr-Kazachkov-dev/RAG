import { LoggerPort } from "../../shared/application/ports/logger.port";
import { GetImagesByKeywordCommand } from '../commands/get-images-by-keyword.command';
import { IImageWithScore } from '../common/interfaces/image.interfaces';
import { ImageRagPort } from "../../domain/ports/image-rag.port";
export declare class GetImagesByKeywordHandler {
    private readonly imageRag;
    private readonly logger;
    constructor(imageRag: ImageRagPort, logger: LoggerPort);
    execute(cmd: GetImagesByKeywordCommand): Promise<Array<IImageWithScore>>;
}
