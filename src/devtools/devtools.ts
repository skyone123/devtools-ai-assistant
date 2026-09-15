let mainPanel: chrome.devtools.panels.ExtensionPanel | null = null;
let panelReady = false;
let pendingAsk: { question: string; focusUrl?: string } | null = null;
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

function dispatchAsk(question: string, focusUrl?: string) {
  showPanel();
  if (panelReady) {
    chrome.runtime.sendMessage({ type: 'quickAsk', question, focusUrl });
  } else {
    pendingAsk = { question, focusUrl };
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
      setTimeout(() => chrome.runtime.sendMessage({ type: 'quickAsk', ...q }), 200);
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
      '请结合下方 Focused Request 的完整详情（响应头、响应体）分析：用途、状态码含义、耗时是否正常、响应数据是否异常，并给出结论与建议。',
      url
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
