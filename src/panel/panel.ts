import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { PortClient } from './lib/port-client.js';
import { NetworkCollector } from './collectors/network.js';
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

const chatHistory: ConversationMessage[] = [];
let isStreaming = false;
let currentAssistantContent = '';
let streamingEl: HTMLDivElement | null = null;
let welcomeRemoved = false;

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

async function sendMessage() {
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
    portClient.ask(context, question, chatHistory);
  } catch (err) {
    showError(err instanceof Error ? err.message : String(err));
    finalizeAssistantMessage();
  }
}

function updateCounts() {
  ctxNetworkCount.textContent = String(networkCollector.getRequestCount());
  getConsoleMessages().then((messages) => {
    const errorCount = messages.filter((m) => m.level === 'error' || m.level === 'warn').length;
    ctxConsoleCount.textContent = String(errorCount);
  });
}

sendBtn.addEventListener('click', sendMessage);

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
    if (isStreaming) return;
    inputEl.value = msg.question;
    sendMessage();
  }
});

chrome.devtools.network.onRequestFinished.addListener(() => {
  ctxNetworkCount.textContent = String(networkCollector.getRequestCount());
});

injectConsoleCapture();
updateCounts();
setInterval(updateCounts, 3000);
