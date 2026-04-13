import { IEmbeddingPort } from "../../domain/ports/embedding.port";
import { OllamaService } from './ollama.service';
export declare class OllamaEmbeddingAdapter implements IEmbeddingPort {
    private readonly ollama;
    constructor(ollama: OllamaService);
    embed(text: string): Promise<number[] | null>;
}
