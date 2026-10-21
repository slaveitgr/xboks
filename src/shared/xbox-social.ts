export interface XboxSocialCapabilities {
  friends: boolean; presence: boolean; inbox: boolean; conversation: boolean;
  send: boolean; search: boolean; partyVoice: boolean;
}
export interface XboxFriend {
  xuid: string; gamertag: string; gamerpicUrl?: string;
  presence: 'online' | 'away' | 'offline' | 'unknown'; activity?: string; lastSeenAt?: string;
}
export interface XboxChatMessage {
  id: string; senderXuid: string; text?: string; sentAt?: string; deleted: boolean;
}
export interface XboxConversation {
  id: string; peerXuid: string; participants: string[]; updatedAt?: string;
  unread: boolean; lastMessage?: XboxChatMessage;
}
export interface XboxSocialResult {
  status: 'ready' | 'signed-out' | 'unsupported' | 'error';
  reason?: string; checkedAt: string; capabilities: XboxSocialCapabilities; selfXuid?: string;
  peerXuid?: string;
  friends?: XboxFriend[]; conversations?: XboxConversation[]; messages?: XboxChatMessage[];
  continuationToken?: string; sent?: { messageId?: string; conversationId?: string };
  omittedConversations?: number;
}
export const noXboxSocialCapabilities: XboxSocialCapabilities = {
  friends: false, presence: false, inbox: false, conversation: false, send: false, search: false, partyVoice: false,
};
