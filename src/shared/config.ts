import type { AIConfig } from './types.js';

const DEFAULT_CONFIG: AIConfig = {
  apiEndpoint: 'http://localhost:11434/v1/chat/completions',
  apiKey: '',
  modelName: 'llama3',
  systemPrompt: '',
  temperature: 0.7,
};

export function getDefaultConfig(): AIConfig {
  return { ...DEFAULT_CONFIG };
}

export async function loadConfig(): Promise<AIConfig> {
  const stored = await chrome.storage.sync.get([
    'apiEndpoint',
    'apiKey',
    'modelName',
    'systemPrompt',
    'temperature',
  ]);
  return {
    apiEndpoint: stored.apiEndpoint || DEFAULT_CONFIG.apiEndpoint,
    apiKey: stored.apiKey || '',
    modelName: stored.modelName || DEFAULT_CONFIG.modelName,
    systemPrompt: stored.systemPrompt || '',
    temperature: typeof stored.temperature === 'number' ? stored.temperature : DEFAULT_CONFIG.temperature,
  };
}

export async function saveConfig(config: AIConfig): Promise<void> {
  await chrome.storage.sync.set({
    apiEndpoint: config.apiEndpoint,
    apiKey: config.apiKey,
    modelName: config.modelName,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
  });
}
