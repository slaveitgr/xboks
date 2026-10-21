import { useState } from 'react';
import { subscriptionBadge } from '../shared/subscription';
import './subscription-badge.css';

const assets: Record<string, { icon: string; width: number }> = {
  ULTIMATE: { icon: 'GamePassUltimateFullHeight', width: 70 },
  'PC GAME PASS': { icon: 'BadgePCGames', width: 69.125 },
  PREMIUM: { icon: 'BadgePremium', width: 66.5 },
  ESSENTIAL: { icon: 'BadgeEssential', width: 70.875 },
};
/** Recognized, current provider subscription only. Legacy AccountTier and
 * Microsoft sign-in never imply a Game Pass membership. */
export function SubscriptionBadge({ value }: { value: unknown }) {
  const label = subscriptionBadge(value), [failed, setFailed] = useState<string>();
  if (!label) return null;
  const asset = assets[label];
  return <span className="account-membership subscription-badge" aria-label={`Game Pass ${label}`} title={`Game Pass ${label}`}
    style={{ '--subscription-badge-width': `${asset?.width ?? 86}px` } as React.CSSProperties}>
    {asset && failed !== label ? <img src={`./original-xbox/icons/${asset.icon}.svg`} alt="" aria-hidden="true" onError={() => setFailed(label)} /> : null}
    <span className={asset && failed !== label ? 'subscription-badge-text with-original' : 'subscription-badge-text'}>{label}</span>
  </span>;
}
