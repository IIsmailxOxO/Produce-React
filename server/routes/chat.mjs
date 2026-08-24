// Producer Chat — contextual AI chat, with rule-based fallback
import { callLLM, getProviderInfo } from '../ai/provider.mjs';
import { buildProducerChatPrompt } from '../ai/prompts.mjs';

export async function handleChat(req) {
  const {
    metadata, transcript, intelligence, valuePoints, claims, angles, research,
    chatMode, activeTimestamp, message, conversationHistory,
  } = req;

  const provider = getProviderInfo();

  // ── If no AI, provide rule-based responses ──
  if (!provider.configured) {
    return {
      reply: generateFallbackReply(message, metadata, intelligence, valuePoints, claims, chatMode, activeTimestamp),
      model: 'rule-based',
      aiAvailable: false,
    };
  }

  // ── AI available ──
  const messages = buildProducerChatPrompt(
    metadata, transcript || '', intelligence || {}, valuePoints || {},
    claims || {}, angles || {}, research || {},
    chatMode || 'produce',
    activeTimestamp || null,
    conversationHistory || []
  );
  messages.push({ role: 'user', content: message });

  try {
    const resp = await callLLM(messages, { temperature: 0.7, maxTokens: 2048 });
    return { reply: resp.content, model: resp.model, aiAvailable: true };
  } catch (err) {
    // If AI call fails, fall back to rule-based rather than showing an error
    return {
      reply: generateFallbackReply(message, metadata, intelligence, valuePoints, claims, chatMode, activeTimestamp),
      model: 'rule-based (AI failed)',
      aiAvailable: false,
    };
  }
}

function generateFallbackReply(message, metadata, intelligence, valuePoints, claims, chatMode, activeTimestamp) {
  const title = metadata?.title || 'this video';
  const channel = metadata?.channel || 'the creator';
  const msg = message.toLowerCase();
  const keyMoments = (intelligence?.keyMoments || []);
  const vpList = (valuePoints?.valuePoints || []);
  const claimsList = (claims?.claims || []);

  // Pattern-match common producer questions
  if (msg.match(/what should i react to|react to|focus on|watch for|pay attention/)) {
    let reply = `Here's what to focus on in "${title}":\n\n`;
    if (keyMoments.length > 0) {
      reply += keyMoments.slice(0, 4).map(m => `• ${m.timestamp || '—'}: ${m.description}`).join('\n');
    } else {
      reply += `• Watch for the strongest claim — that's your reaction anchor\n• Look for emotional shifts — those are your clip moments\n• Note what ${channel} DOESN'T address — that's your original angle`;
    }
    reply += '\n\n💡 Set up an AI provider (OpenRouter has free models) for deeper analysis.';
    return reply;
  }

  if (msg.match(/true|fact|correct|accurate|verify|real|legit/)) {
    if (claimsList.length > 0) {
      const needsCheck = claimsList.filter(c => c.verdict === 'needs_verification');
      return `Claims to verify in "${title}":\n\n${needsCheck.slice(0, 4).map(c => `• "${c.claim.slice(0, 80)}" — ${c.whatToCheck || 'Verify independently'}`).join('\n')}\n\n💡 Connect an AI provider for real-time fact-checking.`;
    }
    return `Without a transcript, I can't identify specific claims. Watch for:\n• Statistics without sources\n• Absolute statements ("always", "never")\n• Predictions about the future\n\nThese are the easiest claims to verify and react to.`;
  }

  if (msg.match(/angle|approach|strategy|plan|structure|how should i/)) {
    const angles = intelligence?.angles || [];
    if (angles.length > 0) {
      return `Reaction angles for "${title}":\n\n${angles.slice(0, 3).map((a, i) => `${i + 1}. **${a.name}**: ${a.hook}`).join('\n')}\n\n💡 AI provider enables custom angle generation for any video.`;
    }
    return `Three approaches always work:\n\n1. **The Analyst**: Verify every claim — be the fact-checker the original isn't\n2. **The Challenger**: Push back on the strongest point — even if you agree, steelman the opposition\n3. **The Explorer**: Go deep on ONE interesting detail everyone else missed\n\n💡 Configure AI for video-specific angle recommendations.`;
  }

  if (msg.match(/missing|gap|what don't i|overlook|skip/)) {
    return `What's likely missing from "${title}":\n\n• The opposing perspective (always)\n• Context about ${channel}'s credibility or bias\n• What happened before/after the events discussed\n• Alternative explanations for the claims made\n\nThese gaps ARE your reaction — fill them and you have original content.`;
  }

  if (msg.match(/hook|opening|start|intro|first 30/)) {
    return `Hook strategies for "${title}":\n\n• Lead with your genuine reaction to the most surprising moment\n• "I found something in this video that nobody's talking about..."\n• Start with a claim from the video and say "Let me check if that's actually true"\n• Reference the view count or controversy: "X million people watched this — but they missed one thing"\n\nThe hook must make viewers stay. Test it: would YOU keep watching?`;
  }

  // Default
  return `I can help with "${title}" using the available analysis, but for detailed, video-specific answers, connect an AI provider.\n\nQuick things I can help with right now:\n• "What should I react to?" — top moments to focus on\n• "Is this true?" — claims that need verification\n• "Give me an angle" — reaction approaches\n• "What am I missing?" — gaps to fill\n• "Hook ideas" — opening strategies\n\n💡 Get a free API key at openrouter.ai to unlock full AI analysis.`;
}
