import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PortClient } from './lib/port-client.js';
import { NetworkCollector } from './collectors/network.js';
import { diffLatestPair } from './analysis/diff.js';
import {
  scanUrlForSecrets,
  scanHeaderForSecrets,
  scanBodiesForSecrets,
  authAudit,
  securityHeaderAudit,
} from './analysis/security.js';
import { collectJwts } from './analysis/jwt.js';
import { enumerateAttackSurface } from './analysis/attack-surface.js';
import { analyzeWaterfall } from './analysis/performance.js';
import {
  CONSOLE_INJECT_SCRIPT,
  CONSOLE_READER_SCRIPT,
  DOM_READ_SCRIPT,
  PAGE_INFO_SCRIPT,
  MAX_CONSOLE_ENTRIES,
} from '../shared/constants.js';
import type {
  CollectedContext,
  ConversationMessage,
  ConsoleMessage,
  DomContext,
  AnalysisContext,
} from '../shared/types.js';

const conversationEl = document.getElementById('conversation')!;
const inputEl = document.getElementById('input') as HTMLTextAreaElement;
const sendBtn = document.getElementById('send') as HTMLButtonElement;
const stopBtn = document.getElementById('stop') as HTMLButtonElement;
const reinjectBtn = document.getElementById('reinject-console') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-chat') as HTMLButtonElement;
const ctxNetwork = document.getElementById('ctx-network') as HTMLInputElement;
const ctxConsole = document.getElementById('ctx-console') as HTMLInputElement;
const ctxDom = document.getElementById('ctx-dom') as HTMLInputElement;
const ctxNetworkCount = document.getElementById('ctx-network-count')!;
const ctxConsoleCount = document.getElementById('ctx-console-count')!;
const tokenBar = document.getElementById('token-bar') as HTMLElement;
const tokenInfo = document.getElementById('token-info')!;
const tokenCopy = document.getElementById('token-copy') as HTMLButtonElement;

const chatHistory: ConversationMessage[] = [];
let isStreaming = false;
let currentAssistantContent = '';
let streamingEl: HTMLDivElement | null = null;
let welcomeRemoved = false;
let activeToken = '';

const networkCollector = new NetworkCollector();

const portClient = new PortClient({
  onChunk: (content) => {
    currentAssistantContent += content;
    renderStreamingMessage();
  },
  onDone: () => {
    finalizeAssistantMessage();
  },
  onError: (message) => {
    showError(message);
    finalizeAssistantMessage();
  },
});

function renderMarkdown(text: string): string {
  const html = marked.parse(text, { async: false }) as string;
  return DOMPurify.sanitize(html);
}

function attachCopyButtons(root: HTMLElement) {
  for (const pre of Array.from(root.querySelectorAll('pre'))) {
    if (!pre.querySelector('.copy-btn')) {
      const btn = document.createElement('button');
      btn.className = 'copy-btn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        const clone = pre.cloneNode(true) as HTMLElement;
        for (const c of Array.from(clone.querySelectorAll('.copy-btn'))) c.remove();
        const text = clone.textContent || '';
        try {
          await navigator.clipboard.writeText(text);
          btn.textContent = 'Copied ✓';
        } catch {
          btn.textContent = 'Copy failed';
        }
        setTimeout(() => (btn.textContent = 'Copy'), 1500);
      });
      pre.style.position = 'relative';
      pre.appendChild(btn);
    }
  }
}

function scrollToBottom() {
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function removeWelcome() {
  if (welcomeRemoved) return;
  const welcome = conversationEl.querySelector('.welcome-message');
  if (welcome) welcome.remove();
  welcomeRemoved = true;
}

function addUserMessage(text: string) {
  removeWelcome();
  const el = document.createElement('div');
  el.className = 'message user';
  el.textContent = text;
  conversationEl.appendChild(el);
  scrollToBottom();
}

function createAssistantMessageElement() {
  removeWelcome();
  streamingEl = document.createElement('div');
  streamingEl.className = 'message assistant streaming';
  conversationEl.appendChild(streamingEl);
  scrollToBottom();
}

function renderStreamingMessage() {
  if (!streamingEl) return;
  const html = renderMarkdown(currentAssistantContent || '');
  streamingEl.innerHTML = html;
  attachCopyButtons(streamingEl);
  scrollToBottom();
}

function finalizeAssistantMessage() {
  if (streamingEl) {
    streamingEl.classList.remove('streaming');
    if (!currentAssistantContent) {
      streamingEl.innerHTML = '<em style="opacity:0.5">(empty response)</em>';
    }
  }
  if (currentAssistantContent) {
    chatHistory.push({
      role: 'assistant',
      content: currentAssistantContent,
      timestamp: Date.now(),
    });
  }
  currentAssistantContent = '';
  streamingEl = null;
  setStreaming(false);
}

function showError(message: string) {
  const el = document.createElement('div');
  el.className = 'message error';
  el.textContent = 'Error: ' + message;
  conversationEl.appendChild(el);
  scrollToBottom();
}

function setStreaming(streaming: boolean) {
  isStreaming = streaming;
  sendBtn.disabled = streaming || inputEl.value.trim() === '';
  stopBtn.hidden = !streaming;
}

function injectConsoleCapture() {
  chrome.devtools.inspectedWindow.eval(CONSOLE_INJECT_SCRIPT, (_result: unknown, exceptionInfo: unknown) => {
    if (exceptionInfo) {
      console.debug('Console inject (may already be injected)');
    }
  });
}

async function getConsoleMessages(): Promise<ConsoleMessage[]> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      CONSOLE_READER_SCRIPT,
      (result: unknown, exceptionInfo: unknown) => {
        if (exceptionInfo || !Array.isArray(result)) {
          resolve([]);
        } else {
          resolve(result as ConsoleMessage[]);
        }
      }
    );
  });
}

async function getDomContext(): Promise<DomContext | undefined> {
  return new Promise((resolve) => {
    chrome.devtools.inspectedWindow.eval(
      DOM_READ_SCRIPT,
      (domResult: unknown, domExceptionInfo: unknown) => {
        if (domExceptionInfo || !domResult || typeof domResult !== 'object') {
          resolve(undefined);
          return;
        }
        const dom = domResult as { html: string; computedStyles: string };
        chrome.devtools.inspectedWindow.eval(
          PAGE_INFO_SCRIPT,
          (pageResult: unknown, pageExceptionInfo: unknown) => {
            const page = (!pageExceptionInfo && pageResult && typeof pageResult === 'object')
              ? pageResult as { url: string; title: string }
              : { url: '', title: '' };
            resolve({
              url: page.url,
              title: page.title,
              selectedHtml: dom.html || '',
              computedStyles: dom.computedStyles || '',
            });
          }
        );
      }
    );
  });
}

async function collectContext(): Promise<CollectedContext> {
  const context: CollectedContext = {};

  if (ctxNetwork.checked) {
    context.network = await networkCollector.getSelectedContext();
  }

  if (ctxConsole.checked) {
    const messages = await getConsoleMessages();
    const errors = messages.filter((m) => m.level === 'error' || m.level === 'warn');
    context.console = (errors.length > 0 ? errors : messages).slice(-MAX_CONSOLE_ENTRIES);
  }

  if (ctxDom.checked) {
    context.dom = await getDomContext();
  }

  return context;
}

async function sendMessage(focusUrl?: string, focusBody?: string, analysis?: AnalysisContext) {
  const question = inputEl.value.trim();
  if (!question || isStreaming) return;

  inputEl.value = '';
  setStreaming(true);

  try {
    addUserMessage(question);
    chatHistory.push({ role: 'user', content: question, timestamp: Date.now() });

    currentAssistantContent = '';
    createAssistantMessageElement();

    const context = await collectContext();
    if (analysis) {
      context.analysis = analysis;
    }
    if (focusUrl) {
      const focus = await networkCollector.getEntryForUrl(focusUrl);
      if (focus) {
        if (focusBody && !focus.responseBody) {
          focus.responseBody = focusBody.substring(0, 4000);
        }
        context.focusEntry = focus;
      } else if (focusBody) {
        context.focusEntry = {
          url: focusUrl,
          method: 'unknown',
          status: 0,
          statusText: '',
          mimeType: '',
          requestHeaders: [],
          responseHeaders: [],
          requestBody: null,
          responseBody: focusBody.substring(0, 4000),
          duration: 0,
          count: 1,
        };
      }
    }
    portClient.ask(context, question, chatHistory);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    finalizeAssistantMessage();
  }
}

async function runTool(tool: string) {
  if (isStreaming) return;
  const btn = document.querySelector<HTMLButtonElement>(`[data-tool="${tool}"]`);
  if (btn) btn.disabled = true;

  const doAsk = async (question: string, analysis?: AnalysisContext, focusUrl?: string, focusBody?: string) => {
    inputEl.value = question;
    await sendMessage(focusUrl, focusBody, analysis);
  };

  try {
    switch (tool) {
      case 'diff': {
        const groups = networkCollector.getDuplicateGroups(1);
        if (groups.length === 0) {
          showError('未发现重复调用同一接口的请求（至少需要 2 次，如翻页两次）');
          break;
        }
        groups.sort((a, b) => {
          const ra = a.requests[a.requests.length - 1].receivedAt;
          const rb = b.requests[b.requests.length - 1].receivedAt;
          return rb - ra;
        });
        const diff = await diffLatestPair(groups[0].requests, (r) => networkCollector.loadResponseBody(r));
        if (diff.error) {
          showError(diff.error);
          break;
        }
        if (diff.same) {
          showError('两次响应结构完全一致，未发现字段差异');
          break;
        }
        await doAsk(
          '对比同一个接口两次调用的响应结构差异，指出新增/删除/变更的字段，判断后端是否悄悄改了 schema，以及这对前端可能造成什么影响。',
          { diff }
        );
        break;
      }
      case 'sensitive': {
        const requests = networkCollector.getAllNonStatic();
        const hits = [
          ...requests.flatMap((r) => scanUrlForSecrets(r)),
          ...requests.flatMap((r) => scanHeaderForSecrets(r)),
          ...(await scanBodiesForSecrets(requests, (r) => networkCollector.loadResponseBody(r))),
        ];
        const deduped = hits.filter(
          (h, i) => hits.findIndex((x) => x.type === h.type && x.sample === h.sample && x.url === h.url) === i
        );
        if (deduped.length === 0) {
          showError('未发现敏感信息泄露，数据较干净');
          break;
        }
        await doAsk(
          `敏感信息扫描发现 ${deduped.length} 处可能泄露。请按严重程度分类（高/中/低）并给出修复建议。`,
          { sensitive: deduped }
        );
        break;
      }
      case 'auth': {
        const audit = authAudit(networkCollector.getAll()).filter((e) => !e.hasAuth);
        if (audit.length === 0) {
          showError('所有接口均检测到 Authorization 头');
          break;
        }
        await doAsk(
          `认证审计发现 ${audit.length} 个接口未携带 Authorization 头。请区分哪些是真正需要鉴权却裸奔的接口，评估风险。`,
          { authAudit: audit }
        );
        break;
      }
      case 'headers': {
        const issues = securityHeaderAudit(networkCollector.getAllNonStatic());
        if (issues.length === 0) {
          showError('未发现缺失的关键安全响应头');
          break;
        }
        await doAsk('安全响应头审计发现缺失项，请解释风险并给出修复方案。', { securityHeaders: issues });
        break;
      }
      case 'surface': {
        const surface = enumerateAttackSurface(networkCollector.getApiRequests());
        if (surface.length === 0) {
          showError('未发现可枚举的 API 路径');
          break;
        }
        await doAsk(
          '基于以下 API 攻击面枚举（仅授权安全测试），推荐值得测试的参数注入 / IDOR / 批量赋值测试点，并说明为什么。',
          { attackSurface: surface }
        );
        break;
      }
      case 'waterfall': {
        const water = analyzeWaterfall(networkCollector.getAllNonStatic());
        const extras: string[] = [];
        if (water.slowTotal.length > 0) {
          extras.push(
            '慢请求(>1s): ' +
              water.slowTotal.map((r) => `${r.method} ${r.url.split('?')[0]}(${Math.round(r.totalTime)}ms)`).join(', ')
          );
        }
        if (water.slowTtfbs.length > 0) {
          extras.push(
            '高TTFB(>500ms): ' +
              water.slowTtfbs.map((r) => `${r.method} ${r.url.split('?')[0]}(${Math.round(r.timings.wait ?? 0)}ms)`).join(', ')
          );
        }
        if (water.sequentialChains.length > 0) {
          extras.push('串行链路: ' + water.sequentialChains.join(' | '));
        }
        const question =
          '分析这个页面的网络性能瀑布。' +
          (extras.length > 0 ? ' 本地预分析得到：' + extras.join('。') : '') +
          ' 请指出导致慢的问题（串行阻塞、高 TTFB、应并行化/合并的资源）并给出优化清单。';
        await doAsk(question, { waterfall: water.entries });
        break;
      }
      case 'mock': {
        const reqs = networkCollector.getApiRequests().slice(-8);
        let chosen: (typeof reqs)[number] | null = null;
        let body: string | null = null;
        for (let i = reqs.length - 1; i >= 0; i--) {
          const candidate = reqs[i];
          const b = await networkCollector.loadResponseBody(candidate);
          if (b && b.trim().startsWith('{')) {
            chosen = candidate;
            body = b;
            break;
          }
        }
        if (!chosen || !body) {
          showError('未找到可用的 JSON 响应体作为 mock 基准');
          break;
        }
        const q =
          `这是一个真实 API 响应（URL: ${chosen.url}，Method: ${chosen.method}）。\n` +
          `请生成 4 个针对前端边界测试的响应变体：1) 空列表/空对象  2) 超长字符串/超大数据  3) 异常结构（字段缺失、类型错误）  4) 极端值（巨大 ID、负数、null）。` +
          `每个变体给出完整 JSON，并说明适合测试哪种前端场景。\n\n真实响应：\n` +
          body.substring(0, 3000);
        await doAsk(q, undefined, chosen.url, body);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
  } finally {
    if (btn) btn.disabled = false;
  }
}

function updateTokenSentinel() {
  const requests = networkCollector.getAll();
  const jwts = collectJwts(requests);
  if (jwts.length === 0) {
    tokenBar.hidden = true;
    activeToken = '';
    return;
  }
  const candidate = jwts[jwts.length - 1];
  if (!candidate.exp || candidate.parseError) {
    tokenBar.hidden = true;
    activeToken = '';
    return;
  }
  const remainingSec = candidate.exp - Date.now() / 1000;
  const expiring = remainingSec < 600;
  activeToken = candidate.token;
  tokenBar.hidden = false;
  tokenBar.classList.toggle('expiring', expiring);
  const who = candidate.source.split(' ')[1] || 'Authorization';
  const remainingHuman =
    remainingSec <= 0
      ? '已过期'
      : remainingSec < 60
        ? `${Math.floor(remainingSec)}s`
        : remainingSec < 3600
          ? `${Math.floor(remainingSec / 60)}m${Math.floor(remainingSec % 60)}s`
          : `${Math.floor(remainingSec / 3600)}h${Math.floor((remainingSec % 3600) / 60)}m`;
  tokenInfo.textContent = `${who} — JWT 剩余 ${remainingHuman}${expiring ? ' ⚠️ 即将过期' : ''}`;
}

tokenCopy.addEventListener('click', async () => {
  if (!activeToken) return;
  try {
    await navigator.clipboard.writeText(activeToken);
    tokenCopy.textContent = 'Copied ✓';
  } catch {
    tokenCopy.textContent = 'Copy failed';
  }
  setTimeout(() => (tokenCopy.textContent = 'Copy'), 1500);
});

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((btn) => {
  btn.addEventListener('click', () => runTool(btn.dataset.tool || ''));
});

function updateCounts() {
  ctxNetworkCount.textContent = String(networkCollector.getRequestCount());
  getConsoleMessages().then((messages) => {
    const errorCount = messages.filter((m) => m.level === 'error' || m.level === 'warn').length;
    ctxConsoleCount.textContent = String(errorCount);
  });
}

sendBtn.addEventListener('click', () => {
  sendMessage();
});

stopBtn.addEventListener('click', () => {
  portClient.abort();
});

reinjectBtn.addEventListener('click', () => {
  chrome.devtools.inspectedWindow.reload({ injectedScript: CONSOLE_INJECT_SCRIPT });
});

inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage();
  }
});

inputEl.addEventListener('input', () => {
  sendBtn.disabled = isStreaming || inputEl.value.trim() === '';
});

clearBtn.addEventListener('click', () => {
  chatHistory.length = 0;
  conversationEl.innerHTML = '';
  welcomeRemoved = false;
  const welcome = document.createElement('div');
  welcome.className = 'welcome-message';
  welcome.innerHTML =
    '<p>Ask AI about network requests, console errors, or CSS issues on this page.</p>' +
    '<p class="hint">Configure your model in the extension options page.</p>';
  conversationEl.appendChild(welcome);
});

document.querySelectorAll<HTMLButtonElement>('#templates .tpl').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (isStreaming) return;
    inputEl.value = btn.dataset.q || '';
    sendMessage();
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'quickAsk' && typeof msg.question === 'string') {
    if (!isStreaming) {
      inputEl.value = msg.question;
      sendMessage(
        typeof msg.focusUrl === 'string' ? msg.focusUrl : undefined,
        typeof msg.focusBody === 'string' ? msg.focusBody : undefined
      );
    }
  }
  return false;
});

chrome.devtools.network.onRequestFinished.addListener(() => {
  ctxNetworkCount.textContent = String(networkCollector.getRequestCount());
});

injectConsoleCapture();
updateCounts();
setInterval(updateCounts, 3000);
setInterval(updateTokenSentinel, 5000);
updateTokenSentinel();

networkCollector.loadFromHAR().finally(() => {
  updateCounts();
  updateTokenSentinel();
});

chrome.runtime.sendMessage({ type: 'panelReady' });
