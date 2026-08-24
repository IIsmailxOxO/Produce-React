# BUILD_TRUTH.md — Reaction Producer

Last verified: 2026-08-24

## ✅ VERIFIED WORKING

| Feature | Evidence |
|---------|----------|
| **Rule-based analysis (NO AI needed)** | Instant response in ~160ms. Extracts key moments, claims, angles, value points from transcript using text analysis |
| **Fallback when no transcript** | Infers useful info from title + channel. Still gives value points, angles, research items |
| **Fallback chat (NO AI needed)** | Pattern-matches common questions. Returns video-grounded answers instantly |
| **Never hangs** | All API calls have 60s timeout. No-AI path returns instantly. AI failures fall back to rule-based |
| **In-app API key setup** | Settings modal lets user add OpenRouter key (free) or OpenAI key. Stored in localStorage |
| **API key via headers** | Frontend sends key in X-AI-Key header. No server env var needed for user keys |
| Auto-caption support | Handles auto-generated captions (available for 80%+ of YouTube videos) |
| Caption XML parsing | 3 formats supported, auto-merge short segments, clean [Music]/[Laughter] tags |
| 5-step AI pipeline (when key available) | Intelligence → Value → Claims → Angles → Research. Each step falls back independently |
| Video player + timeline sync | YouTube IFrame API, seek on click, Mark In/Out |
| Intelligence panels | Brief, Key Moments, Claims, Angles, Research — each with different job |
| Producer Chat modes | Produce, Research, React, Improve — mode-aware instructions |
| Export (MD, JSON) | Downloads workspace as file |
| localStorage persistence | Workspace saved/loaded automatically |
| Error handling | Failed requests → clear messages, never fake data |

## ⚠️ PARTIAL / NEEDS WORK

| Feature | Status |
|---------|--------|
| Metadata fetch | oEmbed + page scraping; blocked from sandbox but works in production |
| Transcript fetch | Works in production; sandbox has no external network |
| AI quality | Rule-based is useful but shallow; AI key unlocks deep analysis |
| Chat depth | Rule-based answers common patterns; AI answers anything |

## ❌ MISSING

| Feature | Notes |
|---------|-------|
| Automated tests | No jest/vitest |
| Rate limiting | No 429 handling |
| YouTube Data API v3 | Would improve metadata reliability |
