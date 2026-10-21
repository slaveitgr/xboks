import {useEffect, useState} from 'react';

const owners = new WeakMap<Document, symbol>();
/** A closing stream host must never release input owned by a newer host. */
export function claimStreamInput(document: Document, owner: symbol, mode: 'menu' | 'active') {
  owners.set(document, owner);
  document.documentElement.dataset.cloudStreamInput = mode;
}
export function releaseStreamInput(document: Document, owner: symbol) {
  if (owners.get(document) !== owner) return;
  owners.delete(document);
  delete document.documentElement.dataset.cloudStreamInput;
}

/** The system Guide/settings temporarily own input; no gamepad frame leaks
 * into a game while an overlay, another window or a hidden tab owns focus. */
export function useStreamObscured(active: boolean) {
  const [obscured, setObscured] = useState(false);
  useEffect(() => {
    if (!active) {setObscured(false); return;}
    const update = () => {
      const overlay = [...document.querySelectorAll<HTMLElement>('.guide-overlay,.xbox-settings-dialog,.cloud-region-dialog')].some(node => {
        const style = getComputedStyle(node);
        return Boolean(node.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden';
      });
      const next = document.hidden || !document.hasFocus() || overlay;
      setObscured(previous => previous === next ? previous : next);
    };
    const observer = new MutationObserver(update);
    observer.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['class','style','hidden','inert','aria-hidden']});
    window.addEventListener('focus', update); window.addEventListener('blur', update); document.addEventListener('visibilitychange', update);
    update();
    return () => {observer.disconnect(); window.removeEventListener('focus', update); window.removeEventListener('blur', update); document.removeEventListener('visibilitychange', update);};
  }, [active]);
  return obscured;
}
