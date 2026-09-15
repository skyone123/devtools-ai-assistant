let mainPanel: chrome.devtools.panels.ExtensionPanel | null = null;
let panelReady = false;
let pendingAsk: { question: string; focusUrl?: string; focusBody?: string } | null = null;
let reopeningResource = false;

const requestUrls = new Set<string>();
const liveRequests = new Map<string, chrome.devtools.network.Request>();

const FOCUS_BODY_LIMIT = 4000;

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
  const url = request.request.url;
  requestUrls.add(url);
  if (requestUrls.size > 300) {
    const oldest = requestUrls.values().next().value;
    if (oldest) requestUrls.delete(oldest);
  }
  liveRequests.set(url, request);
  if (liveRequests.size > 150) {
    const oldestKey = liveRequests.keys().next().value;
    if (oldestKey) liveRequests.delete(oldestKey);
  }
});

function showPanel() {
  (mainPanel as chrome.devtools.panels.ExtensionPanel & { show?: () => void } | null)?.show?.();
}

function dispatchAsk(question: string, focusUrl?: string, focusBody?: string) {
  showPanel();
  if (panelReady) {
    chrome.runtime.sendMessage({ type: 'quickAsk', question, focusUrl, focusBody });
  } else {
    pendingAsk = { question, focusUrl, focusBody };
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
    const question =
      `详细分析这个网络请求：${url}\n\n` +
      '请结合下方 Focused Request 的完整详情（请求体、响应头、响应体）分析：用途、状态码含义、耗时是否正常、响应数据是否异常，并给出结论与建议。';
    const live = liveRequests.get(url);
    if (live) {
      live.getContent((body) => {
        dispatchAsk(question, url, body ? body.substring(0, FOCUS_BODY_LIMIT) : undefined);
      });
    } else {
      dispatchAsk(question, url);
    }
    return;
  }
  if (!reopeningResource) {
    reopeningResource = true;
    chrome.devtools.panels.openResource(url, 0, () => {
      reopeningResource = false;
    });
  }
});
