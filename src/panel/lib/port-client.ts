import { PORT_NAME } from '../../shared/constants.js';
import type { CollectedContext, ConversationMessage, BgToPanelMessage } from '../../shared/types.js';

export interface PortClientHandlers {
  onChunk: (content: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export class PortClient {
  private port: chrome.runtime.Port | null = null;
  private handlers: PortClientHandlers;
  private pending = false;

  constructor(handlers: PortClientHandlers) {
    this.handlers = handlers;
    this.connect();
  }

  private connect() {
    this.port = chrome.runtime.connect({ name: PORT_NAME });
    this.port.onMessage.addListener((msg: BgToPanelMessage) => {
      switch (msg.type) {
        case 'chunk':
          this.handlers.onChunk(msg.content);
          break;
        case 'done':
          this.pending = false;
          this.handlers.onDone();
          break;
        case 'error':
          this.pending = false;
          this.handlers.onError(msg.message);
          break;
      }
    });
    this.port.onDisconnect.addListener(() => {
      this.port = null;
      if (this.pending) {
        this.pending = false;
        this.handlers.onError('Background connection lost');
      }
    });
  }

  ask(context: CollectedContext, question: string, history: ConversationMessage[]) {
    if (!this.port) {
      this.connect();
    }
    if (!this.port) {
      this.handlers.onError('Failed to connect to background');
      return;
    }
    this.pending = true;
    this.port.postMessage({ type: 'ask', context, question, history });
  }

  abort() {
    if (this.port && this.pending) {
      this.port.postMessage({ type: 'abort' });
    }
  }
}
