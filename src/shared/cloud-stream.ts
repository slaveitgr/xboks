/** Account-backed cloud catalog and session DTOs. Credentials never cross IPC. */
export interface CloudStreamTitle {
  productId: string;
  titleId: string;
  xboxTitleId?: string;
  hasEntitlement?: boolean;
  supportedInputTypes: string[];
  programs: string[];
  /** Reported membership in the public BYOG catalog, not proof of ownership. */
  streamYourOwn?: boolean;
}
export interface CloudAccountCatalog {
  status: 'ready' | 'signed-out' | 'unsupported' | 'error';
  titles: CloudStreamTitle[];
  recentProductIds: string[];
  checkedAt: string;
  reason?: string;
  reasonCode?: 'region-not-supported';
}
export interface CloudIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
}
export interface CloudSessionState {
  phase: 'closed' | 'starting' | 'queued' | 'provisioning' | 'ready' | 'error';
  /** Locally generated capability, never a service session ID or URL. */
  id?: string;
  productId?: string;
  error?: 'signed-out' | 'unsupported' | 'account-changed' | 'service' | 'timeout' | 'busy' | 'region-not-supported' | 'transfer-token-required';
  waitSeconds?: number;
}
