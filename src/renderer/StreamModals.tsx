import {useEffect} from 'react';

/** Native streaming views sit above React. Keep them behind visible launcher
 * dialogs, while excluding their own trusted toolbar from modal discovery. */
export function StreamModals() {
  useEffect(() => {
    let active = true, frame = 0, previous: boolean | undefined;
    const update = () => {
      frame = 0; if (!active) return;
      const obscured = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"],.guide-overlay')]
        .some(node => !node.matches('.remote-play-host,.cloud-gaming-host') && !node.closest('.remote-play-host,.cloud-gaming-host') && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden');
      if (obscured === previous) return;
      previous = obscured; document.body.toggleAttribute('data-stream-obscured', obscured);
      void window.launcher.setRemotePlayObscured?.(obscured).catch(() => {});
      void window.launcher.setCloudGamingObscured?.(obscured).catch(() => {});
    };
    const schedule = () => { if (active && !frame) frame = requestAnimationFrame(update); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {subtree:true,childList:true,attributes:true,attributeFilter:['aria-modal','hidden','aria-hidden']});
    update();
    return () => { active = false; observer.disconnect(); cancelAnimationFrame(frame); document.body.removeAttribute('data-stream-obscured'); };
  }, []);
  return null;
}
