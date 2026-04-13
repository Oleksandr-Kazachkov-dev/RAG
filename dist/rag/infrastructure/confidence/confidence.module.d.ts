import { ConfidenceService } from "../../application/services/confidence.service";
export declare const CONFIDENCE_PROVIDERS: (typeof ConfidenceService | {
    provide: string;
    useExisting: typeof ConfidenceService;
})[];
export declare const confidenceConfig: () => {
    rag: {
        confidence: {
            high: number;
            low: number;
        };
    };
};
