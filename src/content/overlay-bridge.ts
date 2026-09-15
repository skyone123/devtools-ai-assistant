export {};
interface OverlayError {
  level: 'error' | 'warn';
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  count: number;
  timestamp: number;
  url: string;
}

function buildQuestion(err: OverlayError): string {
  const lines: string[] = [];
  lines.push('Explain this browser runtime error:');
  lines.push('');
  lines.push(`- Level: ${err.level}`);
  lines.push(`- Page: ${err.url}`);
  if (err.source) lines.push(`- Source: ${err.source}${err.line ? ':' + err.line : ''}`);
  lines.push(`- Message: ${err.message}`);
  lines.push(`- Occurrences: ${err.count}`);
  if (err.stack) {
    lines.push('');
    lines.push('Stack:');
    lines.push('```');
    lines.push(err.stack.substring(0, 1500));
    lines.push('```');
  }
  lines.push('');
  lines.push('Locate the root cause and provide concrete fixes.');
  return lines.join('\n');
}

let devtoolsOpen = false;
let lastFeedback: { status: 'ok' | 'no-devtools' } | null = null;
let probePort: chrome.runtime.Port | null = null;

function connectProbe() {
  try {
    probePort = chrome.runtime.connect({ name: 'ai-overlay' });
    probePort.onMessage.addListener((msg: { type?: string; open?: boolean }) => {
      if (msg && msg.type === 'ai-overlay-open' && typeof msg.open === 'boolean') {
        if (msg.open !== devtoolsOpen) {
          devtoolsOpen = msg.open;
          window.postMessage({ __aiOverlayDevtools: devtoolsOpen }, '*');
          if (devtoolsOpen === false && lastFeedback) {
            window.postMessage({ __aiOverlayAskStatus: 'no-devtools' }, '*');
            lastFeedback = null;
          }
        }
      }
    });
    probePort.onDisconnect.addListener(() => {
      probePort = null;
      if (devtoolsOpen) {
        devtoolsOpen = false;
        window.postMessage({ __aiOverlayDevtools: false }, '*');
      }
    });
  } catch {
    probePort = null;
  }
}

function sendProbe() {
  if (probePort) {
    try {
      probePort.postMessage({ type: 'probe' });
    } catch {
      /* port gone */
    }
  } else {
    connectProbe();
  }
}

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const data = e.data as {
    __aiOverlayAsk?: boolean;
    error?: OverlayError;
    __aiOverlayJump?: boolean;
    source?: string;
    line?: number;
  } | null;
  if (!data || typeof data !== 'object') return;

  if (data.__aiOverlayJump === true && typeof data.source === 'string') {
    try {
      chrome.runtime.sendMessage({ type: 'jumpToSource', url: data.source, line: data.line || 1 });
    } catch {
      /* background may be unavailable */
    }
    return;
  }

  if (data.__aiOverlayAsk !== true || !data.error) return;

  const question = buildQuestion(data.error);
  if (!devtoolsOpen) {
    window.postMessage({ __aiOverlayAskStatus: 'no-devtools' }, '*');
    return;
  }

  try {
    chrome.runtime.sendMessage({ type: 'quickAsk', question }, () => {
      const ok = !chrome.runtime.lastError;
      lastFeedback = ok ? { status: 'ok' } : { status: 'no-devtools' };
      window.postMessage({ __aiOverlayAskStatus: ok ? 'ok' : 'no-devtools' }, '*');
    });
  } catch {
    window.postMessage({ __aiOverlayAskStatus: 'no-devtools' }, '*');
  }
});

connectProbe();
sendProbe();
setInterval(sendProbe, 2000);