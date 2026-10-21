/** Browser-enforced network boundary for localhost-only renderer fixtures.
 * Ordered Network block patterns avoid pausing browser requests. The optional
 * offscreen Electron runner supplies the equivalent native request boundary. */
export const fixtureContentSecurityPolicy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; base-uri 'none'; form-action 'none'";
export function fixtureNetworkBoundary(origin, report, verifyElectronDenial) {
  const requests = new Map();
  const deniedProbe = 'http://127.0.0.2:65534/__xboks-denied-network-probe';
  let probeBlocked = false;
  return {
    handle(message) {
      if (message.method === 'Network.requestWillBeSent') requests.set(message.params.requestId, message.params.request.url);
      if (message.method === 'Network.loadingFailed' && message.params.blockedReason === 'inspector') {
        const url = requests.get(message.params.requestId);
        if (url === deniedProbe) probeBlocked = true;
        if (url && !report.blockedRequests.includes(url)) report.blockedRequests.push(url);
      }
      if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') requests.delete(message.params.requestId);
    },
    async install(send) {
      const urlPatterns = [
        { urlPattern: `${origin}/*`, block: false },
        { urlPattern: `${origin.replace(/^http/, 'ws')}/*`, block: false },
        ...['http', 'https', 'ws', 'wss'].map(scheme => ({ urlPattern: `${scheme}://*:*/*`, block: true })),
      ];
      await send('Network.enable');
      // An unsupported browser fails closed here, before loading the fixture.
      if(!verifyElectronDenial)await send('Network.setBlockedURLs', { urlPatterns });
      await send('Page.navigate', { url: 'data:text/html,<title>Isolated network boundary probe</title>' });
      const value = await send('Runtime.evaluate', { expression: `fetch(${JSON.stringify(deniedProbe)}).then(()=>false,()=>true)`, awaitPromise: true, returnByValue: true });
      if (value.exceptionDetails || value.result?.value !== true) throw Error('The fixture network boundary allowed its denied loopback probe.');
      if(verifyElectronDenial)probeBlocked=await verifyElectronDenial(deniedProbe);
      for (let attempt = 0; attempt < 20 && !probeBlocked; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
      if (!probeBlocked) throw Error('The browser did not confirm network denial.');
      report.networkBoundary = { method: verifyElectronDenial ? 'Electron.session.webRequest' : 'Network.setBlockedURLs', fixtureOriginOnly: true, deniedLoopbackProbeVerified: true };
    },
  };
}
