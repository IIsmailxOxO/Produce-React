// Specialized AI prompts for the Reaction Producer intelligence pipeline

export function buildVideoIntelligencePrompt(metadata, transcript) {
  return `You are the Lead Producer analyzing a video for a reaction creator. Analyze ONLY the information actually available. Do not invent facts.

VIDEO: "${metadata.title}" by ${metadata.channel}
${metadata.description ? `DESCRIPTION: ${metadata.description.slice(0, 1000)}` : ''}
${metadata.viewCount ? `VIEWS: ${metadata.viewCount.toLocaleString()}` : ''}

${transcript ? `TRANSCRIPT:\n${transcript.slice(0, 12000)}` : 'TRANSCRIPT: Not available for this video.'}

Identify and return as JSON:
{
  "summary": "What is this video about? (2-3 sentences grounded in actual content)",
  "centralArgument": "The main thesis or story the video presents",
  "keyMoments": [
    {"timestamp": "MM:SS", "description": "What happens and why it matters", "significance": "high|medium|low"}
  ],
  "emotionalArc": "How the emotional tone shifts through the video",
  "genre": "What type of content this is (educational, commentary, entertainment, etc.)"
}

Timestamps must come from the transcript. If transcript is unavailable, omit timestamps and note "Transcript unavailable."`;
}

export function buildValuePointsPrompt(metadata, transcript, intelligence) {
  return `You are finding the highest-value elements for a reaction creator.

VIDEO: "${metadata.title}"
CENTRAL ARGUMENT: ${(intelligence || {}).centralArgument || 'Unknown'}
KEY MOMENTS: ${JSON.stringify((intelligence || {}).keyMoments || [])}

${transcript ? `TRANSCRIPT EXCERPTS:\n${transcript.slice(0, 8000)}` : 'TRANSCRIPT: Not available'}

Return JSON:
{
  "valuePoints": [
    {
      "point": "What the creator can add that the original doesn't provide",
      "why": "Why this creates value for viewers",
      "type": "curiosity|emotion|controversy|humor|education|disagreement|originality",
      "researchNeeded": false,
      "timestamp": "MM:SS or null"
    }
  ]
}`;
}

export function buildClaimsPrompt(metadata, transcript, intelligence) {
  return `You are a rigorous editorial researcher. Identify claims, statements, statistics, and facts that deserve verification.

VIDEO: "${metadata.title}"
${transcript ? `TRANSCRIPT:\n${transcript.slice(0, 10000)}` : 'TRANSCRIPT: Not available'}

Return JSON:
{
  "claims": [
    {
      "claim": "The exact claim or statement made",
      "timestamp": "MM:SS or null",
      "category": "fact|statistic|opinion|prediction|implication",
      "verdict": "likely_true|needs_verification|likely_false|opinion|unverifiable",
      "whatToCheck": "What specifically should be verified",
      "whyItMatters": "Why this matters for the reaction",
      "sources": ["Suggested source or search query to verify"]
    }
  ]
}

Never present an unverified claim as fact.`;
}

export function buildReactionAnglesPrompt(metadata, intelligence, valuePoints, claims) {
  return `Develop genuinely different ways to turn this video into a strong reaction video.

VIDEO: "${metadata.title}" by ${metadata.channel}
CENTRAL ARGUMENT: ${(intelligence || {}).centralArgument || 'Unknown'}
VALUE POINTS: ${JSON.stringify(((valuePoints || {}).valuePoints || []).slice(0, 5))}
CLAIMS: ${JSON.stringify(((claims || {}).claims || []).slice(0, 5))}

Return JSON:
{
  "angles": [
    {
      "name": "Short name for this approach",
      "angle": "The unique perspective or position",
      "hook": "A compelling opening for the reaction",
      "momentsToEmphasize": ["Which moments to focus on"],
      "researchNeeded": ["What to research before recording"],
      "style": "agreement|disagreement|educational|entertainment|investigative|emotional",
      "audiencePayoff": "What viewers get from this approach"
    }
  ]
}

Provide 3-5 distinct approaches. Base every approach on the actual video content.`;
}

export function buildResearchPrompt(claims, metadata) {
  return `Based on the claims identified, suggest research the creator should do before reacting.

VIDEO: "${metadata.title}"
CLAIMS: ${JSON.stringify((claims || {}).claims || [])}

Return JSON:
{
  "researchItems": [
    {
      "topic": "What to research",
      "why": "Why this research strengthens the reaction",
      "queries": ["Search queries to use"],
      "relatedClaims": ["Which claims this research addresses"],
      "priority": "critical|important|nice_to_have"
    }
  ]
}`;
}

export function buildProducerChatPrompt(
  metadata, transcript, intelligence, valuePoints, claims, angles, research,
  chatMode, activeTimestamp, conversationHistory
) {
  const timestampContext = activeTimestamp
    ? `\nACTIVE TIMESTAMP: ${formatTime(activeTimestamp)} — The creator is currently at this point in the video. Prioritize analysis relevant to this moment.`
    : '';

  const transcriptContext = transcript
    ? `\nTRANSCRIPT (timestamps refer to video time):\n${transcript.slice(0, 10000)}`
    : '\nTRANSCRIPT: Not available for this video.';

  const modeInstructions = {
    produce: 'Help the creator plan and structure their reaction. Focus on what to say, when to say it, and how to make the video compelling.',
    research: 'Help the creator investigate claims and find evidence. Focus on what needs verification and where to find answers.',
    react: 'Help the creator in the moment — what to say right now, how to respond to what\'s on screen, comedic angles, emotional beats.',
    improve: 'Help the creator strengthen their existing reaction plan. Challenge weak ideas, identify missed opportunities, suggest better angles.',
  };

  const systemPrompt = `You are the creator's Producer AI — an experienced producer sitting beside them while they prepare a reaction video.

You have access to the current video's information. Your answers MUST be grounded in THIS specific video. If information is unavailable, say so clearly. Never fabricate video-specific facts.

VIDEO: "${metadata.title}" by ${metadata.channel}
${metadata.description ? `DESCRIPTION: ${metadata.description.slice(0, 500)}` : ''}

INTELLIGENCE SUMMARY: ${(intelligence || {}).summary || 'Not yet analyzed'}
CENTRAL ARGUMENT: ${(intelligence || {}).centralArgument || 'Not yet analyzed'}
KEY MOMENTS: ${JSON.stringify(((intelligence || {}).keyMoments || []).slice(0, 5))}
VALUE POINTS: ${JSON.stringify(((valuePoints || {}).valuePoints || []).slice(0, 5))}
CLAIMS: ${JSON.stringify(((claims || {}).claims || []).slice(0, 5))}
REACTION ANGLES: ${JSON.stringify(((angles || {}).angles || []).slice(0, 3))}
RESEARCH: ${JSON.stringify(((research || {}).researchItems || []).slice(0, 3))}
${transcriptContext}
${timestampContext}

CURRENT MODE: ${chatMode} — ${modeInstructions[chatMode] || modeInstructions.produce}

RULES:
- Answer specifically about THIS video, not generic advice
- Reference timestamps when relevant
- Challenge weak ideas and identify missed opportunities
- If the creator asks about a claim, check against the claims analysis
- If the creator asks what to react to, reference specific key moments and value points
- Be direct and practical — this is production, not philosophy
- When you don't know something, say "I don't have enough information to answer that specifically" rather than guessing`;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Add conversation history (last 20 messages max)
  const history = (conversationHistory || []).slice(-20);
  for (const msg of history) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  return messages;
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
