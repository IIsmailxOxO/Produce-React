// Fallback analysis — works WITHOUT any AI provider
// Uses rule-based text analysis on the transcript to extract real value.
// This means the app provides value even with zero AI keys configured.

export function analyzeWithoutAI(metadata, transcript, segments) {
  const title = metadata.title || '';
  const channel = metadata.channel || '';
  const description = metadata.description || '';
  const hasTranscript = !!(transcript && transcript.length > 50);

  // ── Intelligence ──
  const intelligence = {
    summary: hasTranscript
      ? `This video by ${channel} covers: ${extractTopic(transcript, title)}. ${extractKeyTheme(transcript)}`
      : `"${title}" by ${channel}. ${description ? description.slice(0, 200) : 'No description available.'}`,
    centralArgument: hasTranscript
      ? extractCentralArgument(transcript)
      : inferFromTitle(title),
    keyMoments: hasTranscript
      ? extractKeyMoments(segments, transcript)
      : [],
    emotionalArc: hasTranscript ? detectEmotionalArc(transcript) : 'Cannot determine without transcript',
    genre: detectGenre(title, description),
    source: 'rule-based',
  };

  // ── Value Points ──
  const valuePoints = {
    valuePoints: hasTranscript
      ? extractValuePoints(transcript, segments)
      : inferValueFromTitle(title, channel),
    source: 'rule-based',
  };

  // ── Claims ──
  const claims = {
    claims: hasTranscript
      ? extractClaims(transcript, segments)
      : [],
    source: 'rule-based',
  };

  // ── Angles ──
  const angles = {
    angles: generateAngles(title, channel, intelligence, hasTranscript),
    source: 'rule-based',
  };

  // ── Research ──
  const research = {
    researchItems: generateResearch(title, channel, claims, hasTranscript),
    source: 'rule-based',
  };

  // ── Producer Brief ──
  const producerBrief = {
    summary: intelligence.summary,
    centralArgument: intelligence.centralArgument,
    topMoments: intelligence.keyMoments.slice(0, 5),
    topClaims: claims.claims.slice(0, 5).map(c => ({ claim: c.claim, verdict: c.verdict })),
    topAngles: angles.angles.slice(0, 3).map(a => ({ name: a.name, hook: a.hook })),
    researchPriority: research.researchItems.filter(r => r.priority === 'critical').length > 0
      ? `${research.researchItems.filter(r => r.priority === 'critical').length} items need research before recording`
      : 'No critical blockers',
  };

  return { intelligence, valuePoints, claims, angles, research, producerBrief, model: 'rule-based', generatedAt: new Date().toISOString() };
}

// ── Helpers ──

function extractTopic(transcript, title) {
  // Extract most common meaningful words (not stop words)
  const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','shall','can','need','dare','ought','used','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','that','this','these','those','it','its','i','me','my','we','our','you','your','he','him','his','she','her','they','them','their','what','which','who','whom','whose']);
  
  const words = (transcript + ' ' + title).toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 6).map(e => e[0]);
  return topWords.join(', ');
}

function extractKeyTheme(transcript) {
  const sentences = transcript.match(/[^.!?]+[.!?]/g) || [];
  if (sentences.length === 0) return '';
  // Look for sentences with strong signal words
  const strongWords = ['important', 'critical', 'key', 'main', 'essential', 'fundamental', 'significant', 'crucial', 'actually', 'really', 'fact', 'proof', 'evidence', 'claim', 'argue', 'believe', 'truth'];
  const strong = sentences.filter(s => strongWords.some(w => s.toLowerCase().includes(w)));
  if (strong.length > 0) return strong[0].trim();
  return sentences[Math.floor(sentences.length / 3)].trim(); // return a sentence from early-middle
}

function extractCentralArgument(transcript) {
  // Look for "because", "therefore", "so", "which means", "the point is"
  const signals = ['the point is', 'what this means', 'the reason', 'because', 'therefore', 'which means', 'so the', 'basically', 'essentially', 'fundamentally'];
  const lower = transcript.toLowerCase();
  for (const sig of signals) {
    const idx = lower.indexOf(sig);
    if (idx !== -1) {
      const start = Math.max(0, idx - 30);
      const end = Math.min(transcript.length, idx + sig.length + 100);
      const sentence = transcript.slice(start, end).trim();
      // Clean up to sentence boundary
      const firstPeriod = sentence.indexOf('.', sig.length + 10);
      if (firstPeriod > 0) return sentence.slice(0, firstPeriod + 1);
      return sentence;
    }
  }
  // Fallback: first substantial sentence
  const sentences = transcript.match(/[^.!?]+[.!?]/g) || [];
  for (const s of sentences) {
    if (s.trim().length > 30) return s.trim();
  }
  return 'Central argument could not be automatically determined from the transcript.';
}

function inferFromTitle(title) {
  if (!title) return 'Unable to determine without transcript or detailed title.';
  // Try to infer from title structure
  if (title.includes('vs') || title.includes('VS')) return `Comparing/contresting: ${title}`;
  if (title.includes('?')) return `Exploring the question: ${title}`;
  if (title.match(/how to|how I|ways to|tips for/i)) return `Teaching/demonstrating: ${title}`;
  if (title.match(/why |reason |because/i)) return `Explaining reasoning: ${title}`;
  return `Title suggests: "${title}" — watch and identify the core thesis.`;
}

function extractKeyMoments(segments, transcript) {
  if (!segments || segments.length === 0) return [];
  
  const moments = [];
  // Split transcript into chunks aligned with segments
  const chunkSize = Math.max(1, Math.floor(segments.length / 8));
  
  for (let i = 0; i < segments.length; i += chunkSize) {
    const chunk = segments.slice(i, i + chunkSize);
    const text = chunk.map(s => s.text).join(' ');
    const start = chunk[0].start;
    const ts = formatTimestamp(start);
    
    // Score this chunk for interest
    let score = 0;
    let significance = 'low';
    
    // Questions
    if (text.includes('?')) { score += 3; }
    // Strong claims
    if (text.match(/\b(is|are|will|must|always|never|every|all|none|fact|proof|proven)\b/i)) { score += 2; }
    // Numbers/statistics
    if (text.match(/\d+%|\d+\s*(million|billion|thousand|people|years|percent)/i)) { score += 3; }
    // Emotional words
    if (text.match(/\b(amazing|shocking|incredible|terrible|horrible|beautiful|insane|crazy|unbelievable)\b/i)) { score += 2; }
    // Contradictions/disagreements
    if (text.match(/\b(but however|actually|wrong|incorrect|disagree|contrary|instead)\b/i)) { score += 3; }
    // New topic shifts (longer phrases, capitalized words)
    if (text.match(/[A-Z][a-z]+ [A-Z][a-z]+/)) { score += 1; }
    
    if (score >= 5) significance = 'high';
    else if (score >= 3) significance = 'medium';
    
    if (score >= 2) {
      moments.push({
        timestamp: ts,
        description: text.slice(0, 120).trim() + (text.length > 120 ? '...' : ''),
        significance,
        score,
      });
    }
  }
  
  return moments.sort((a, b) => b.score - a.score).slice(0, 10);
}

function detectEmotionalArc(transcript) {
  const quarters = 4;
  const sentences = transcript.match(/[^.!?]+[.!?]/g) || [];
  const quarterLen = Math.floor(sentences.length / quarters);
  
  const positiveWords = new Set(['great','amazing','love','happy','excited','beautiful','wonderful','awesome','fantastic','good','best','perfect','incredible','brilliant','excellent']);
  const negativeWords = new Set(['bad','terrible','horrible','wrong','fail','problem','issue','worried','concern','danger','risk','crisis','worst','awful','ugly','stupid','hate','angry','frustrated']);
  
  const arcs = [];
  for (let q = 0; q < quarters; q++) {
    const chunk = sentences.slice(q * quarterLen, (q + 1) * quarterLen).join(' ').toLowerCase().split(/\s+/);
    let pos = 0, neg = 0;
    for (const w of chunk) {
      if (positiveWords.has(w)) pos++;
      if (negativeWords.has(w)) neg++;
    }
    if (pos > neg + 2) arcs.push('positive');
    else if (neg > pos + 2) arcs.push('negative');
    else arcs.push('neutral');
  }
  
  if (arcs.length === 0) return 'Cannot determine emotional arc.';
  return `Starts ${arcs[0]}, moves through ${arcs.slice(1, -1).join(', ') || 'middle'}, ends ${arcs[arcs.length - 1]}.`;
}

function detectGenre(title, description) {
  const combined = (title + ' ' + description).toLowerCase();
  if (combined.match(/tutorial|how to|guide|step by step|learn/i)) return 'educational';
  if (combined.match(/review|unboxing|first look|hands on/i)) return 'review';
  if (combined.match(/vlog|day in|my life|grwm/i)) return 'vlog';
  if (combined.match(/news|breaking|update|report/i)) return 'news';
  if (combined.match(/reaction|react|respond/i)) return 'reaction';
  if (combined.match(/interview|conversation|talk|discussion/i)) return 'interview';
  if (combined.match(/debate|argument|vs|versus/i)) return 'debate';
  if (combined.match(/comedy|funny|skit|parody|prank/i)) return 'comedy';
  if (combined.match(/documentary|doc|story|history/i)) return 'documentary';
  return 'commentary';
}

function extractValuePoints(transcript, segments) {
  const points = [];
  const sentences = transcript.match(/[^.!?]+[.!?]/g) || [];
  
  // Questions → curiosity value
  const questions = sentences.filter(s => s.includes('?'));
  for (const q of questions.slice(0, 3)) {
    const ts = findTimestampForText(segments, q);
    points.push({
      point: `Unanswered question: ${q.trim().slice(0, 80)}`,
      why: 'Questions create curiosity gaps — viewers stay engaged when you explore them',
      type: 'curiosity',
      researchNeeded: true,
      timestamp: ts,
    });
  }
  
  // Claims → controversy/disagreement value
  const claimWords = /\b(is|are|will|must|always|never|every|proven|fact|truth|obviously|clearly)\b/i;
  const claims = sentences.filter(s => claimWords.test(s) && s.trim().length > 20);
  for (const c of claims.slice(0, 3)) {
    const ts = findTimestampForText(segments, c);
    points.push({
      point: `Claim to address: ${c.trim().slice(0, 80)}`,
      why: 'Strong claims invite reaction — agree, disagree, or provide context the original lacks',
      type: 'controversy',
      researchNeeded: true,
      timestamp: ts,
    });
  }
  
  // Emotional moments → emotion value
  const emotionalWords = /\b(amazing|shocking|incredible|terrible|heartbreaking|beautiful|insane)\b/i;
  const emotional = sentences.filter(s => emotionalWords.test(s));
  for (const e of emotional.slice(0, 2)) {
    const ts = findTimestampForText(segments, e);
    points.push({
      point: `Emotional moment: ${e.trim().slice(0, 80)}`,
      why: 'Emotional moments are reaction gold — your genuine response adds value',
      type: 'emotion',
      researchNeeded: false,
      timestamp: ts,
    });
  }
  
  // If we didn't find much, add generic useful points
  if (points.length < 2 && transcript.length > 100) {
    points.push({
      point: 'Identify the 3 strongest moments in the first 30 seconds for your hook',
      why: 'Hook retention determines whether viewers stay — lead with your strongest reaction',
      type: 'originality',
      researchNeeded: false,
      timestamp: null,
    });
    points.push({
      point: 'Find where the speaker is most confident and challenge that confidence',
      why: 'Confident claims that go unchallenged are the best reaction opportunities',
      type: 'disagreement',
      researchNeeded: true,
      timestamp: null,
    });
  }
  
  return points;
}

function inferValueFromTitle(title, channel) {
  const points = [];
  points.push({
    point: `Analyze "${title}" for claims that need verification`,
    why: 'Every video makes claims — identifying which ones are unverified gives your reaction unique value',
    type: 'controversy',
    researchNeeded: true,
    timestamp: null,
  });
  points.push({
    point: `What perspective does ${channel} NOT address?`,
    why: 'The missing perspective IS your reaction — find it and you have original content',
    type: 'originality',
    researchNeeded: true,
    timestamp: null,
  });
  points.push({
    point: 'Watch for the moment that surprises you most — that\'s your clip',
    why: 'Genuine surprise is the most shareable reaction moment',
    type: 'emotion',
    researchNeeded: false,
    timestamp: null,
  });
  return points;
}

function extractClaims(transcript, segments) {
  const claims = [];
  const sentences = transcript.match(/[^.!?]+[.!?]/g) || [];
  
  // Sentences with numbers/statistics
  const statSentences = sentences.filter(s => s.match(/\d+%|\d+\s*(million|billion|thousand|percent|people|years|times)/i));
  for (const s of statSentences.slice(0, 3)) {
    const ts = findTimestampForText(segments, s);
    claims.push({
      claim: s.trim().slice(0, 120),
      timestamp: ts,
      category: 'statistic',
      verdict: 'needs_verification',
      whatToCheck: 'Verify this statistic from an independent source',
      whyItMatters: 'Statistics are often misquoted or outdated — verifying them adds credibility to your reaction',
      sources: ['Search for the specific statistic with "fact check"'],
    });
  }
  
  // Absolute claims (always, never, every, all, must)
  const absoluteClaims = sentences.filter(s => s.match(/\b(always|never|every|all |none|must|impossible|certain|guaranteed)\b/i) && s.trim().length > 20);
  for (const s of absoluteClaims.slice(0, 3)) {
    const ts = findTimestampForText(segments, s);
    claims.push({
      claim: s.trim().slice(0, 120),
      timestamp: ts,
      category: 'fact',
      verdict: 'needs_verification',
      whatToCheck: 'Absolute claims are rarely true — find counterexamples',
      whyItMatters: 'Absolute statements are the easiest to fact-check and react to',
      sources: ['Search for exceptions or counterexamples'],
    });
  }
  
  // Predictions
  const predictions = sentences.filter(s => s.match(/\b(will |going to|predict|expect|forecast|estimate)\b/i));
  for (const s of predictions.slice(0, 2)) {
    const ts = findTimestampForText(segments, s);
    claims.push({
      claim: s.trim().slice(0, 120),
      timestamp: ts,
      category: 'prediction',
      verdict: 'unverifiable',
      whatToCheck: 'Check if similar past predictions came true',
      whyItMatters: 'Predictions are great for reaction — you can assess their plausibility',
      sources: ['Search for similar past predictions and their outcomes'],
    });
  }
  
  return claims;
}

function generateAngles(title, channel, intelligence, hasTranscript) {
  const genre = intelligence.genre || 'commentary';
  const angles = [];
  
  angles.push({
    name: 'The Analyst',
    angle: `Break down "${title}" claim by claim. Verify what's true, flag what isn't, and provide context the original lacks.`,
    hook: hasTranscript
      ? 'Let me check every claim in this video...'
      : `"${title}" — but is any of it actually true?`,
    momentsToEmphasize: ['First major claim', 'Statistics or numbers', 'Conclusion'],
    researchNeeded: ['Verify key claims before recording'],
    style: 'educational',
    audiencePayoff: 'Viewers get fact-checked information, not just entertainment',
  });
  
  angles.push({
    name: 'The Challenger',
    angle: `Push back on ${channel}'s strongest points. Even if you agree, steelman the opposition.`,
    hook: `"${channel}" makes a compelling case — but here's what they're not telling you.`,
    momentsToEmphasize: ['Most confident statements', 'Emotional appeals', 'Omissions'],
    researchNeeded: ['Research the opposing perspective'],
    style: 'disagreement',
    audiencePayoff: 'Original perspective that the original video deliberately avoids',
  });
  
  angles.push({
    name: 'The Explorer',
    angle: `Go deeper on the most interesting part. Don't react to everything — pick the ONE thing worth going deep on.`,
    hook: `Everyone's talking about the main story. I want to talk about the detail everyone missed.`,
    momentsToEmphasize: ['Overlooked details', 'Asides or footnotes', 'Implications'],
    researchNeeded: ['Deep research on the most interesting subtopic'],
    style: 'investigative',
    audiencePayoff: 'Depth that surface-level reactions miss',
  });
  
  if (genre === 'educational' || genre === 'tutorial') {
    angles.push({
      name: 'The Practitioner',
      angle: `Actually DO what the video teaches and show what happens. Real results beat theory.`,
      hook: `They say this works. Let's find out if it actually does.`,
      momentsToEmphasize: ['Key instructions', 'Claims about results', 'Warnings'],
      researchNeeded: ['Get the materials/tools needed to replicate'],
      style: 'educational',
      audiencePayoff: 'Proof that it works (or doesn\'t) — way more valuable than just watching',
    });
  }
  
  return angles;
}

function generateResearch(title, channel, claims, hasTranscript) {
  const items = [];
  
  if (claims.claims && claims.claims.length > 0) {
    const needsVerification = claims.claims.filter(c => c.verdict === 'needs_verification');
    if (needsVerification.length > 0) {
      items.push({
        topic: `Verify ${needsVerification.length} claim(s) from the video`,
        why: 'Unverified claims are the backbone of a strong reaction — you can be the one who actually checks them',
        queries: needsVerification.slice(0, 3).map(c => c.claim.slice(0, 60)),
        relatedClaims: needsVerification.slice(0, 3).map(c => c.claim.slice(0, 40)),
        priority: 'critical',
      });
    }
  }
  
  items.push({
    topic: `Research ${channel}'s background and credibility`,
    why: 'Understanding the source helps you assess their claims and add context',
    queries: [`${channel} credibility`, `${channel} background`, `${channel} controversy`],
    relatedClaims: [],
    priority: 'important',
  });
  
  items.push({
    topic: 'Find what other creators said about this',
    why: 'You want to be different. Know what\'s already been said so you can add something new',
    queries: [`${title} reaction`, `${title} response`],
    relatedClaims: [],
    priority: 'important',
  });
  
  return items;
}

function findTimestampForText(segments, text) {
  if (!segments || segments.length === 0) return null;
  const firstWords = text.toLowerCase().slice(0, 20).split(/\s+/).filter(w => w.length > 2);
  for (const seg of segments) {
    const segLower = seg.text.toLowerCase();
    if (firstWords.some(w => segLower.includes(w))) {
      return formatTimestamp(seg.start);
    }
  }
  return null;
}

function formatTimestamp(seconds) {
  if (!seconds && seconds !== 0) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
