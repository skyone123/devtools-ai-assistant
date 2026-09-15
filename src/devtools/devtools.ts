let mainPanel: chrome.devtools.panels.ExtensionPanel | null = null;

chrome.devtools.panels.create(
  'AI Assistant',
  'icons/icon48.png',
  'panel.html',
  (panel) => {
    mainPanel = panel;
  }
);

chrome.devtools.panels.elements.createSidebarPane('AI Assistant', (sidebar) => {
  sidebar.setPage('sidebar.html');
  sidebar.setHeight('132px');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'quickAsk' && mainPanel) {
    (mainPanel as chrome.devtools.panels.ExtensionPanel & { show?: () => void }).show?.();
  }
});

let reopeningResource = false;

chrome.devtools.panels.setOpenResourceHandler((resource) => {
  const url = resource.url;
  chrome.runtime.sendMessage({ type: 'resourceDoubleClicked', url }, (response) => {
    if (response?.handled) {
      (mainPanel as chrome.devtools.panels.ExtensionPanel & { show?: () => void } | null)?.show?.();
    } else if (!reopeningResource) {
      reopeningResource = true;
      chrome.devtools.panels.openResource(url, 0, () => {
        reopeningResource = false;
      });
    }
  });
});

let heartbeatPort: chrome.runtime.Port | null = null;
try {
  heartbeatPort = chrome.runtime.connect({ name: 'ai-devtools' });
  heartbeatPort.postMessage({
    type: 'hello',
    tabId: chrome.devtools.inspectedWindow.tabId,
  });
} catch {
  heartbeatPort = null;
}

chrome.devtools.network.onNavigated.addListener(() => {
  if (heartbeatPort) {
    try {
      heartbeatPort.postMessage({ type: 'ping', tabId: chrome.devtools.inspectedWindow.tabId });
    } catch {
      heartbeatPort = null;
    }
  }
});

window.addEventListener('pagehide', () => {
  try {
    heartbeatPort?.disconnect();
  } catch {
    /* noop */
  }
  heartbeatPort = null;
});