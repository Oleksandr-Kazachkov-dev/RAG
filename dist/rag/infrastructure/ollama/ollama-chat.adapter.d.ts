import { IChatLlmPort, LlmOptions } from "../../domain/ports/chat-llm.port";
import { OllamaService } from './ollama.service';
export declare class OllamaChatAdapter implements IChatLlmPort {
    private readonly ollama;
    constructor(ollama: OllamaService);
    complete(prompt: string, options?: LlmOptions): Promise<string>;
    describeImage(imageBuffer: Buffer, mimeType: string): Promise<string>;
    extractKeywords(text: string): Promise<string[]>;
}
