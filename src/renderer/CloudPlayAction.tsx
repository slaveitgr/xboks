import {useEffect, useRef, useState} from 'react';
import type {AuthStatus} from '../shared/types';
import type {CloudAccountCatalog} from '../shared/cloud-stream';
import type {CloudLoginCountry} from '../shared/cloud-region';
import type {CloudStreamApi} from '../shared/cloud-library';
import {Cloud} from './XboxIcons';
import {useReferenceLocale} from './ReferenceLocale';
import './cloud-play-action.css';

/** Only a current authenticated title entitlement may expose the streaming action. */
export function entitledCloudProduct(account: CloudAccountCatalog | undefined, productId?: string, primaryProductId?: string): string | undefined {
  if (account?.status !== 'ready') return;
  return [productId, primaryProductId].find(id => id && /^[A-Z0-9]{12}$/.test(id)
    && account.titles.some(title => title.productId === id && title.hasEntitlement === true));
}

export interface CloudPlayActionProps {
  productId?: string; primaryProductId?: string; auth?: AuthStatus;
  country?: CloudLoginCountry; market?: string; identity?: string;
  account?: CloudAccountCatalog; accountLoading?: boolean; disabled?: boolean;
  bridge?: Partial<CloudStreamApi>; onPlay?: (productId: string) => Promise<unknown>;
}
export function CloudPlayAction({productId, primaryProductId, auth, country = 'auto', market, identity,
  account, accountLoading, disabled, bridge = typeof window === 'undefined' ? undefined : window.launcher, onPlay}: CloudPlayActionProps) {
  const {text: t} = useReferenceLocale();
  const identityKey = `${productId}:${primaryProductId}:${auth?.stored}:${auth?.running}:${auth?.username ?? ''}:${country}:${market}:${identity}`;
  const scope = useRef({identity: identityKey, revision: 0});
  // Returning to the same identity after another sign-in is a new observation,
  // never permission to reuse that identity's previous entitlement snapshot.
  if (scope.current.identity !== identityKey) scope.current = {identity: identityKey, revision: scope.current.revision + 1};
  const key = `${scope.current.revision}:${identityKey}`;
  const [result, setResult] = useState<{key: string; account: CloudAccountCatalog}>(), [pending, setPending] = useState(''), [failure, setFailure] = useState('');
  const latest = useRef(key); latest.current = key;
  const request = useRef<string>();
  useEffect(() => {
    let current = true;
    if (account || !auth?.stored || auth.running || !productId || !bridge?.getCloudAccountCatalog) return;
    void bridge.getCloudAccountCatalog().then(value => {if (current) setResult({key, account: value});}).catch(() => {});
    return () => {current = false;};
  }, [key, account, bridge]);
  const title = !auth?.stored || auth.running || accountLoading ? undefined : entitledCloudProduct(account ?? (result?.key === key ? result.account : undefined), productId, primaryProductId);
  if (!title || (!onPlay && !bridge?.startCloudStream)) return null;
  const launch = async () => {
    if (request.current === key || disabled) return;
    const ownedKey = key; request.current = ownedKey; setPending(ownedKey); setFailure('');
    try {await (onPlay ? onPlay(title) : bridge!.startCloudStream!(title));}
    catch {if (latest.current === ownedKey) setFailure(ownedKey);}
    finally {if (request.current === ownedKey) request.current = undefined; setPending(value => value === ownedKey ? '' : value);}
  };
  return <span className="cloud-play-action-wrap"><button className="cloud-play-action" disabled={disabled || pending === key} onClick={() => void launch()}>
    <Cloud/><span>{pending === key ? t('Connecting…', 'Σύνδεση…') : t('Play with Cloud', 'Αναπαραγωγή με το Cloud')}</span>
  </button>{failure === key ? <small role="alert">{t('Cloud play could not start. Try again.', 'Η αναπαραγωγή cloud δεν ξεκίνησε. Δοκιμάστε ξανά.')}</small> : null}</span>;
}
