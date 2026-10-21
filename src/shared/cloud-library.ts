import type {CloudAccountCatalog, CloudIceCandidate, CloudSessionState} from './cloud-stream.js';

export type CloudCollection = 'all' | 'own' | 'popular' | 'recent' | 'ea';
export interface CloudPublicCatalog {
  collections: Record<CloudCollection, string[]>;
  checkedAt: string;
}
/** Public descriptive metadata is independent of account ownership. */
export interface CloudProduct {
  productId: string;
  title: string;
  publisher?: string;
  description: string;
  posterUrl?: string;
  heroUrl?: string;
  categories: string[];
}
export interface CloudStreamApi {
  getCloudPublicCatalog(refresh?: boolean): Promise<CloudPublicCatalog>;
  getCloudProducts(ids: string[]): Promise<CloudProduct[]>;
  getCloudAccountCatalog(refresh?: boolean): Promise<CloudAccountCatalog>;
  startCloudStream(productId: string): Promise<CloudSessionState>;
  getCloudStreamState(id?: string): Promise<CloudSessionState>;
  onCloudStreamState(callback: (state: CloudSessionState) => void): () => void;
  exchangeCloudSdp(id: string, sdp: string): Promise<string>;
  exchangeCloudIce(id: string, candidates: CloudIceCandidate[]): Promise<CloudIceCandidate[]>;
  stopCloudStream(id?: string): Promise<void>;
}
