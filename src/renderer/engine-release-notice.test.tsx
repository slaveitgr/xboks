import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EngineReleaseNotice } from './EngineReleaseNotice';

describe('installed Engine and release-channel status', () => {
  it('shows unpublished channels as information without claiming an installed failure', () => {
    const html = renderToStaticMarkup(<EngineReleaseNotice state="unpublished" error="No release" installed />);
    expect(html).toContain('engine-release-note'); expect(html).toContain('installed version remains selected');
    expect(html).not.toContain('alert amber');
  });
  it('does not claim a retained installation when none exists', () => {
    const html = renderToStaticMarkup(<EngineReleaseNotice state="unpublished" installed={false} runtime />);
    expect(html).toContain('runtime update'); expect(html).not.toContain('installed version remains selected');
  });
  it('retains actionable update errors', () => {
    const html = renderToStaticMarkup(<EngineReleaseNotice state="error" error="HTTP 503" installed />);
    expect(html).toContain('alert amber'); expect(html).toContain('HTTP 503');
  });
});
