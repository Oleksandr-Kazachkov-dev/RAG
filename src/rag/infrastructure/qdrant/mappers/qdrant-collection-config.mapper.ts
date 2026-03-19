import { Schemas } from '@qdrant/js-client-rest';
import { CollectionConfig } from 'src/rag/domain/value-objects/collection-config.vo';

type QdrantDistance = Schemas['Distance'];

export class QdrantCollectionConfigMapper {
  static toQdrantConfig(config: CollectionConfig): Schemas['CreateCollection'] {
    const hnswConfig = config.hnswConfig;

    const m =
      hnswConfig && typeof hnswConfig.m === 'number'
        ? hnswConfig.m
        : 32;

    const efConstruct =
      hnswConfig && typeof hnswConfig.efConstruct === 'number'
        ? hnswConfig.efConstruct
        : 256;

    return {
      vectors: {
        size: config.vectorSize,
        distance: this.mapDistance(config.distance),
        on_disk: true,
      },

      hnsw_config: {
        m,
        ef_construct: efConstruct,
      },

      on_disk_payload: true,

      optimizers_config: {
        indexing_threshold: 0,
        memmap_threshold: 50_000,
        default_segment_number: 2,
      },
    };
  }

  private static mapDistance(distance: string): QdrantDistance {
    switch (distance.toLowerCase()) {
      case 'cosine': return 'Cosine';
      case 'euclid': return 'Euclid';
      case 'dot': return 'Dot';
      case 'manhattan': return 'Manhattan';
      default:
        throw new Error(`Unsupported distance metric: "${distance}"`);
    }
  }
}