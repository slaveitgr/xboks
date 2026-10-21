export interface GuidePerformance {
  status: 'available' | 'unavailable';
  sampledAt: string;
  cpuPercent?: number;
  memory?: { usedBytes: number; totalBytes: number; percent: number };
  gpuPercent?: number;
  vram?: { usedBytes: number; totalBytes: number; percent: number };
  reason?: string;
}
export interface GuideCapture {
  id: string;
  name: string;
  createdAt: string;
  sizeBytes: number;
  thumbnailUrl?: string;
}
export interface GuideGallery {
  status: 'available' | 'unavailable';
  items: GuideCapture[];
  reason?: string;
}
