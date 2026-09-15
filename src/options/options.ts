import { loadConfig, saveConfig } from '../shared/config.js';

const endpointInput = document.getElementById('apiEndpoint') as HTMLInputElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const modelInput = document.getElementById('modelName') as HTMLInputElement;
const systemPromptInput = document.getElementById('systemPrompt') as HTMLTextAreaElement;
const temperatureInput = document.getElementById('temperature') as HTMLInputElement;
const tempVal = document.getElementById('temp-val')!;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const testBtn = document.getElementById('test') as HTMLButtonElement;
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
  statusEl.style.color = '#4a9eff';
  statusEl.textContent = 'Saved!';
  setTimeout(() => {
    statusEl.textContent = '';
  }, 2000);
});

testBtn.addEventListener('click', async () => {
  testBtn.disabled = true;
  statusEl.style.color = '#a0a0a0';
  statusEl.textContent = 'Testing...';

  const started = Date.now();
  try {
    const config = {
      apiEndpoint: endpointInput.value.trim(),
      apiKey: apiKeyInput.value.trim(),
      modelName: modelInput.value.trim(),
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
    }

    const response = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.modelName,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        max_tokens: 5,
      }),
    });

    const elapsed = Date.now() - started;
    if (response.ok) {
      statusEl.style.color = '#4ade80';
      statusEl.textContent = `OK (${elapsed}ms)`;
    } else {
      const body = await response.text().catch(() => '');
      statusEl.style.color = '#ff5252';
      statusEl.textContent = `HTTP ${response.status}: ${body.substring(0, 120)}`;
    }
  } catch (err) {
    statusEl.style.color = '#ff5252';
    statusEl.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    testBtn.disabled = false;
  }
});

init();
