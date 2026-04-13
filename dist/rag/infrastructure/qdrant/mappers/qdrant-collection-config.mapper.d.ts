import { Schemas } from '@qdrant/js-client-rest';
import { CollectionConfig } from "../../../domain/value-objects/collection-config.vo";
export declare class QdrantCollectionConfigMapper {
    static toQdrantConfig(config: CollectionConfig): Schemas['CreateCollection'];
    private static mapDistance;
}
