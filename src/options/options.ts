import { loadConfig, saveConfig } from '../shared/config.js';

const endpointInput = document.getElementById('apiEndpoint') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const modelInput = document.getElementById('modelName') as HTMLInputElement;
const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
const temperatureInput = document.getElementById('temperature') as HTMLInputElement;
const tempVal = document.getElementById('temp-val')!;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;

async function init() {
  const config = await loadConfig();
  endpointInput.value = config.apiEndpoint;
  apiKeyInput.value = config.apiKey;
  modelInput.value = config.modelName;
  systemPromptInput.value = config.systemPrompt;
  temperatureInput.value = String(config.temperature);
  tempVal.textContent = String(config.temperature);
}

temperatureInput.addEventListener('input', () => {
  tempVal.textContent = temperatureInput.value;
});

saveBtn.addEventListener('click', async () => {
  await saveConfig({
    apiEndpoint: endpointInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    modelName: modelInput.value.trim(),
    systemPrompt: systemPromptInput.value,
    temperature: parseFloat(temperatureInput.value),
  });
  statusEl.textContent = 'Saved!';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
});

init();
