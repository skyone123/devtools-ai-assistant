let mainPanel: chrome.devtools.panels.ExtensionPanel | null = null;
let panelReady = false;
let pendingAsk: string | null = null;
let reopeningResource = false;

const requestUrls = new Set<string>();

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

chrome.devtools.network.onRequestFinished.addListener((request) => {
  requestUrls.add(request.request.url);
  if (requestUrls.size > 300) {
    const oldest = requestUrls.values().next().value;
    if (oldest) requestUrls.delete(oldest);
  }
});

function showPanel() {
  (mainPanel as chrome.devtools.panels.ExtensionPanel & { show?: () => void } | null)?.show?.();
}

function dispatchAsk(question: string) {
  showPanel();
  if (panelReady) {
    chrome.runtime.sendMessage({ type: 'quickAsk', question });
  } else {
    pendingAsk = question;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'quickAsk' && typeof msg.question === 'string') {
    showPanel();
    return false;
  }
  if (msg && msg.type === 'panelReady') {
    panelReady = true;
    if (pendingAsk) {
      const q = pendingAsk;
      pendingAsk = null;
      setTimeout(() => chrome.runtime.sendMessage({ type: 'quickAsk', question: q }), 200);
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

chrome.devtools.panels.setOpenResourceHandler((resource) => {
  const url = resource.url;
  if (requestUrls.has(url)) {
    dispatchAsk(
      `详细分析这个网络请求：${url}\n\n` +
      '请从上下文中的请求列表/错误详情定位它，说明用途、状态码含义、耗时是否正常，若有异常给出根因和修复建议。'
    );
    return;
  }
  if (!reopeningResource) {
    reopeningResource = true;
    chrome.devtools.panels.openResource(url, 0, () => {
      reopeningResource = false;
    });
  }
});
