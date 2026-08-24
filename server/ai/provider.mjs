// AI Provider — supports OpenRouter (free models), OpenAI, custom endpoints
// IMPORTANT: OpenRouter has FREE models that work without payment.

function getProviderConfig() {
  // Allow runtime override: if user set a key via Settings UI, use it
  const envType = process.env.AI_PROVIDER_TYPE || 'openrouter';
  const type = runtimeProvider || envType;

  if (type === 'openai') {
    return {
      type: 'openai',
      apiKey: runtimeApiKey || process.env.OPENAI_API_KEY || '',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    };
  }

  if (type === 'custom') {
    return {
      type: 'custom',
      apiKey: process.env.AI_API_KEY || '',
      baseUrl: process.env.AI_BASE_URL || '',
      model: process.env.AI_MODEL || '',
    };
  }

  // Default: OpenRouter (has free models)
  return {
    type: 'openrouter',
    apiKey: runtimeApiKey || process.env.OPENROUTER_API_KEY || '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: process.env.AI_MODEL || 'google/gemma-2-9b-it:free',
  };
}

// Allow per-request override of API key (from frontend Settings)
let runtimeApiKey = null;
let runtimeProvider = null;

export function setRuntimeApiKey(key) {
  runtimeApiKey = key;
}

export function setRuntimeProvider(type) {
  runtimeProvider = type;
}

export async function callLLM(messages, options) {
  const config = getProviderConfig();
  const apiKey = runtimeApiKey || config.apiKey;
  const temperature = (options || {}).temperature ?? 0.7;
  const maxTokens = (options || {}).maxTokens ?? 4096;

  if (!apiKey) {
    throw new Error('NO_AI_KEY');
  }

  const body = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    ...(config.type === 'openrouter' ? {
      'HTTP-Referer': 'https://r1-producer.app',
      'X-Title': 'R1 Producer',
    } : {}),
  };

  const url = `${config.baseUrl}/chat/completions`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000); // 60s max

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI_ERROR_${resp.status}: ${errorText.slice(0, 200)}`);
    }

    const data = await resp.json();
    const choice = (data.choices || [])[0];

    if (!choice || !choice.message || !choice.message.content) {
      throw new Error('AI returned empty response');
    }

    return {
      content: choice.message.content,
      model: data.model || config.model,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      } : undefined,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getProviderInfo() {
  const config = getProviderConfig();
  const hasKey = !!(runtimeApiKey || config.apiKey);
  return {
    type: config.type,
    model: config.model,
    configured: hasKey,
    needsKey: !hasKey,
    message: hasKey
      ? `Using ${config.type} / ${config.model}`
      : 'Add an API key in Settings (free at openrouter.ai)',
  };
}
