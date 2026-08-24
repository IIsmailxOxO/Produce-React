// Evaluation pipeline: AI if available, instant fallback if not. NEVER hangs.
import { callLLM, getProviderInfo } from '../ai/provider.mjs';
import { analyzeWithoutAI } from '../ai/fallback-analysis.mjs';
import {
  buildVideoIntelligencePrompt,
  buildValuePointsPrompt,
  buildClaimsPrompt,
  buildReactionAnglesPrompt,
  buildResearchPrompt,
} from '../ai/prompts.mjs';

export async function handleEvaluate(req) {
  const { metadata, transcript, transcriptSegments } = req;
  const provider = getProviderInfo();

  // ── If no AI key, use instant rule-based analysis ──
  if (!provider.configured) {
    console.log('[evaluate] No AI key → using rule-based fallback analysis');
    const result = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    return { ...result, aiAvailable: false, aiMessage: provider.message };
  }

  // ── AI available: run the multi-prompt pipeline ──
  console.log(`[evaluate] AI available (${provider.type}/${provider.model}) → running 5-step pipeline`);
  let model = 'unknown';

  // Step 1: Video Intelligence
  let intelligence = {};
  try {
    const r = await callLLM([{ role: 'user', content: buildVideoIntelligencePrompt(metadata, transcript || '') }], { temperature: 0.3, maxTokens: 2048 });
    model = r.model;
    intelligence = parseJsonResponse(r.content);
  } catch (err) {
    console.error('[evaluate] Step 1 failed:', err.message);
    // Fall back to rule-based for this step
    const fb = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    intelligence = fb.intelligence;
  }

  // Step 2: Value Points
  let valuePoints = {};
  try {
    const r = await callLLM([{ role: 'user', content: buildValuePointsPrompt(metadata, transcript || '', intelligence) }], { temperature: 0.4, maxTokens: 2048 });
    valuePoints = parseJsonResponse(r.content);
  } catch (err) {
    console.error('[evaluate] Step 2 failed:', err.message);
    const fb = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    valuePoints = fb.valuePoints;
  }

  // Step 3: Claims
  let claims = {};
  try {
    const r = await callLLM([{ role: 'user', content: buildClaimsPrompt(metadata, transcript || '', intelligence) }], { temperature: 0.2, maxTokens: 2048 });
    claims = parseJsonResponse(r.content);
  } catch (err) {
    console.error('[evaluate] Step 3 failed:', err.message);
    const fb = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    claims = fb.claims;
  }

  // Step 4: Angles
  let angles = {};
  try {
    const r = await callLLM([{ role: 'user', content: buildReactionAnglesPrompt(metadata, intelligence, valuePoints, claims) }], { temperature: 0.6, maxTokens: 2048 });
    angles = parseJsonResponse(r.content);
  } catch (err) {
    console.error('[evaluate] Step 4 failed:', err.message);
    const fb = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    angles = fb.angles;
  }

  // Step 5: Research
  let research = {};
  try {
    const r = await callLLM([{ role: 'user', content: buildResearchPrompt(claims, metadata) }], { temperature: 0.3, maxTokens: 2048 });
    research = parseJsonResponse(r.content);
  } catch (err) {
    console.error('[evaluate] Step 5 failed:', err.message);
    const fb = analyzeWithoutAI(metadata, transcript || '', transcriptSegments || []);
    research = fb.research;
  }

  // Build Producer Brief
  const keyMoments = intelligence.keyMoments || [];
  const claimsList = claims.claims || [];
  const anglesList = angles.angles || [];
  const researchList = research.researchItems || [];

  const producerBrief = {
    summary: intelligence.summary || 'Analysis unavailable.',
    centralArgument: intelligence.centralArgument || '',
    topMoments: keyMoments.slice(0, 5).map(m => ({ timestamp: m.timestamp || '—', description: m.description || '' })),
    topClaims: claimsList.slice(0, 5).map(c => ({ claim: c.claim || '', verdict: c.verdict || 'unknown' })),
    topAngles: anglesList.slice(0, 3).map(a => ({ name: a.name || '', hook: a.hook || '' })),
    researchPriority: researchList.filter(r => r.priority === 'critical').length > 0
      ? `${researchList.filter(r => r.priority === 'critical').length} critical research items need attention before recording`
      : 'No critical research blockers',
  };

  return {
    intelligence, valuePoints, claims, angles, research, producerBrief,
    model, generatedAt: new Date().toISOString(), aiAvailable: true,
  };
}

function parseJsonResponse(content) {
  try { return JSON.parse(content); } catch {}
  const codeBlockMatch = content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) { try { return JSON.parse(codeBlockMatch[1]); } catch {} }
  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) { try { return JSON.parse(content.slice(firstBrace, lastBrace + 1)); } catch {} }
  return {};
}
