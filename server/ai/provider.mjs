// AI Provider — uses api/key-rotation.mjs to rotate keys on rate limits
import { pickKey, recordSuccess, recordRateLimit, recordError, getStatus, configuredCount } from '../../api/key-rotation.mjs';

// Also support a single runtime key from the Settings UI (fallback)
let runtimeApiKey = null;
let runtimeProvider = null;

export function setRuntimeApiKey(key) { runtimeApiKey = key; }
export function setRuntimeProvider(type) { runtimeProvider = type; }

export async function callLLM(messages, options) {
  const temperature = (options || {}).temperature ?? 0.7;
  const maxTokens = (options || {}).maxTokens ?? 4096;

  // Try rotating keys first, then fall back to runtime key
  let key = pickKey();
  let apiKey, baseUrl, model, providerType, keyName;

  if (key) {
    apiKey = key.apiKey;
    model = key.model;
    providerType = key.provider;
    keyName = key.name;
    baseUrl = providerType === 'openai'
      ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
      : 'https://openrouter.ai/api/v1';
  } else if (runtimeApiKey) {
    // Fallback: single key from Settings UI
    apiKey = runtimeApiKey;
    providerType = runtimeProvider || 'openrouter';
    keyName = 'settings-ui';
    baseUrl = providerType === 'openai'
      ? (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1')
      : 'https://openrouter.ai/api/v1';
    model = providerType === 'openai' ? 'gpt-4o-mini' : 'google/gemma-2-9b-it:free';
  } else {
    throw new Error('NO_AI_KEY');
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    ...(providerType === 'openrouter' ? {
      'HTTP-Referer': 'https://r1-producer.app',
      'X-Title': 'R1 Producer',
    } : {}),
  };

  const url = `${baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // Handle rate limiting — rotate key
    if (resp.status === 429) {
      if (key) recordRateLimit(keyName);
      // Try again with a different key
      const nextKey = pickKey();
      if (nextKey && nextKey.name !== keyName) {
        console.log(`[provider] Retrying with ${nextKey.name}...`);
        clearTimeout(timeout);
        return callLLM(messages, options); // recurse with new key
      }
      throw new Error('All API keys rate-limited. Wait a moment and try again.');
    }

    if (!resp.ok) {
      const errorText = await resp.text();
      if (key) recordError(keyName);
      throw new Error(`AI_ERROR_${resp.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const choice = (data.choices || [])[0];

    if (!choice || !choice.message || !choice.message.content) {
      if (key) recordError(keyName);
      throw new Error('AI returned empty response');
    }

    if (key) recordSuccess(keyName);
    return {
      content: choice.message.content,
      model: data.model || model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      } : undefined,
      keyName,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('AI request timed out (60s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export function getProviderInfo() {
  const count = configuredCount();
  const hasRuntimeKey = !!runtimeApiKey;
  const configured = count > 0 || hasRuntimeKey;
  return {
    type: 'rotating',
    model: `${count} key${count !== 1 ? 's' : ''} in api/keys.json`,
    configured,
    needsKey: !configured,
    keyCount: count,
    keyStatus: getStatus(),
    message: configured
      ? `${count} rotating key${count !== 1 ? 's' : ''} configured` + (hasRuntimeKey ? ' + 1 settings key' : '')
      : 'Add keys to api/keys.json (see the file for setup)',
  };
}
