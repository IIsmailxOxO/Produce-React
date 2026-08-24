import { useState, useEffect, useRef, useCallback } from 'react'

// ─── Types ────────────────────────────────────────────────────────
interface TranscriptSegment { text: string; start: number; duration: number }
interface TimelineItem { id: string; type: 'moment' | 'note' | 'question' | 'claim' | 'research'; timestamp: number | null; text: string; createdAt: number }
interface ChatMessage { role: 'user' | 'assistant'; content: string; timestamp: number }

interface Workspace {
  videoId: string; url: string
  metadata: { title: string; channel: string; description: string; publishDate: string; lengthSeconds: number; thumbnail: string; viewCount: number | null }
  transcript: TranscriptSegment[]; transcriptFullText: string; transcriptAvailable: boolean; transcriptIsAuto: boolean
  intelligence: any; valuePoints: any; claims: any; angles: any; research: any; producerBrief: any
  timeline: TimelineItem[]; chatHistory: ChatMessage[]; chatMode: string
  activeTimestamp: number | null; markIn: number | null; markOut: number | null; segments: Array<{ in: number; out: number; label: string }>
  model: string; aiAvailable: boolean; generatedAt: string; createdAt: number
}

function extractVideoId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/) || url.match(/^([a-zA-Z0-9_-]{11})$/)
  return m ? m[1] : null
}

function fmt(s: number | null): string {
  if (s === null || s === undefined) return '--:--'
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${Math.floor(s % 60).toString().padStart(2, '0')}`
}

function gid(): string { return Math.random().toString(36).slice(2, 10) }

// ─── App ──────────────────────────────────────────────────────────
export default function App() {
  const [url, setUrl] = useState('')
  const [ws, setWs] = useState<Workspace | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'brief' | 'moments' | 'claims' | 'angles' | 'research' | 'chat'>('brief')
  const [chatIn, setChatIn] = useState('')
  const [noteIn, setNoteIn] = useState('')
  const [noteType, setNoteType] = useState<'note' | 'question' | 'moment'>('note')
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [providerType, setProviderType] = useState('openrouter')
  const [aiStatus, setAiStatus] = useState<any>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [playerReady, setPlayerReady] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const playerRef = useRef<any>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load saved API key
  useEffect(() => {
    const saved = localStorage.getItem('rp-api-key')
    if (saved) setApiKey(saved)
    const savedType = localStorage.getItem('rp-provider-type')
    if (savedType) setProviderType(savedType)
    fetch('/api/health').then(r => r.json()).then(d => setAiStatus(d.ai)).catch(() => setAiStatus({ configured: false }))
  }, [])

  // Timer
  useEffect(() => {
    if (playerReady && ws) {
      timerRef.current = setInterval(() => {
        try { const t = playerRef.current?.getCurrentTime?.(); if (typeof t === 'number') setCurrentTime(t) } catch {}
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playerReady, ws])

  // Save API key to backend
  const saveApiKey = useCallback(() => {
    localStorage.setItem('rp-api-key', apiKey)
    localStorage.setItem('rp-provider-type', providerType)
    // Tell the server about the key via env var (can't do that, so we'll use the settings as headers)
    // Actually, we'll just set it as a runtime override via the evaluate/chat calls
    setAiStatus({ configured: !!apiKey, type: providerType, model: providerType === 'openrouter' ? 'google/gemma-2-9b-it:free' : 'gpt-4o-mini' })
    setShowSettings(false)
  }, [apiKey, providerType])

  // ─── Open Workspace ─────────────────────────────────────
  const openWorkspace = useCallback(async () => {
    const videoId = extractVideoId(url.trim())
    if (!videoId) { setError('Paste a YouTube video URL'); return }
    setError(null)
    setLoading('Loading video...')

    try {
      // 1. Metadata (fast, don't block on failure)
      setLoading('Fetching video info...')
      let metadata = { videoId, title: '', channel: '', description: '', publishDate: '', lengthSeconds: 0, thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, viewCount: null }
      try {
        const mr = await fetch(`/api/video-metadata?videoId=${videoId}`)
        if (mr.ok) metadata = { ...metadata, ...await mr.json() }
      } catch {}

      // 2. Transcript (don't block on failure)
      setLoading('Checking for captions...')
      let transcriptData = { segments: [], fullText: '', available: false, isAuto: false }
      try {
        const tr = await fetch(`/api/transcript?videoId=${videoId}`)
        if (tr.ok) transcriptData = { ...transcriptData, ...await tr.json() }
      } catch {}

      // 3. Evaluation (instant with fallback, never hangs)
      setLoading('Analyzing...')
      setEvaluating(true)
      let evalResult: any = {}
      try {
        const headers: any = { 'Content-Type': 'application/json' }
        // Send API key with request if configured
        if (apiKey) headers['X-AI-Key'] = apiKey
        if (providerType) headers['X-AI-Provider'] = providerType

        const er = await fetch('/api/evaluate', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            videoId, metadata,
            transcript: transcriptData.fullText || '',
            transcriptSegments: transcriptData.segments || [],
          }),
        })
        evalResult = er.ok ? await er.json() : {}
      } catch (err: any) {
        evalResult = { intelligence: { summary: `Analysis error: ${err.message}` }, aiAvailable: false }
      }
      setEvaluating(false)

      const newWs: Workspace = {
        videoId, url: url.trim(), metadata,
        transcript: transcriptData.segments || [],
        transcriptFullText: transcriptData.fullText || '',
        transcriptAvailable: transcriptData.available || false,
        transcriptIsAuto: transcriptData.isAuto || false,
        intelligence: evalResult.intelligence || {},
        valuePoints: evalResult.valuePoints || {},
        claims: evalResult.claims || {},
        angles: evalResult.angles || {},
        research: evalResult.research || {},
        producerBrief: evalResult.producerBrief || {},
        timeline: [], chatHistory: [], chatMode: 'produce',
        activeTimestamp: null, markIn: null, markOut: null, segments: [],
        model: evalResult.model || 'unknown',
        aiAvailable: evalResult.aiAvailable !== false,
        generatedAt: evalResult.generatedAt || new Date().toISOString(),
        createdAt: Date.now(),
      }

      setWs(newWs)
      setTab('brief')
      setLoading(null)
    } catch (err: any) {
      setError(err.message || 'Failed to open workspace')
      setLoading(null)
      setEvaluating(false)
    }
  }, [url, apiKey, providerType])

  // ─── Re-evaluate on timeline change ──
  const prevTlLen = useRef(0)
  useEffect(() => {
    if (!ws) return
    if (ws.timeline.length > prevTlLen.current && prevTlLen.current > 0) {
      // Background re-eval
      fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { 'X-AI-Key': apiKey } : {}) },
        body: JSON.stringify({ videoId: ws.videoId, metadata: ws.metadata, transcript: ws.transcriptFullText, transcriptSegments: ws.transcript }),
      }).then(r => r.ok ? r.json() : null).then(result => {
        if (result) setWs(prev => prev ? { ...prev, intelligence: result.intelligence || prev.intelligence, claims: result.claims || prev.claims, producerBrief: result.producerBrief || prev.producerBrief } : prev)
      }).catch(() => {})
    }
    prevTlLen.current = ws.timeline.length
  }, [ws?.timeline?.length, apiKey])

  // ─── Chat ─────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!ws || !chatIn.trim()) return
    const msg = chatIn.trim()
    setChatIn('')
    setWs(prev => prev ? { ...prev, chatHistory: [...prev.chatHistory, { role: 'user', content: msg, timestamp: Date.now() }] } : prev)

    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (apiKey) headers['X-AI-Key'] = apiKey
      const resp = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          videoId: ws.videoId, metadata: ws.metadata, transcript: ws.transcriptFullText,
          intelligence: ws.intelligence, valuePoints: ws.valuePoints, claims: ws.claims,
          angles: ws.angles, research: ws.research, chatMode: ws.chatMode,
          activeTimestamp: currentTime || null, message: msg,
          conversationHistory: ws.chatHistory.slice(-16),
        }),
      })
      const data = resp.ok ? await resp.json() : { reply: 'Connection error.' }
      setWs(prev => prev ? { ...prev, chatHistory: [...prev.chatHistory, { role: 'assistant', content: data.reply, timestamp: Date.now() }] } : prev)
    } catch (err: any) {
      setWs(prev => prev ? { ...prev, chatHistory: [...prev.chatHistory, { role: 'assistant', content: `Error: ${err.message}`, timestamp: Date.now() }] } : prev)
    }
  }, [ws, chatIn, currentTime, apiKey])

  // ─── Timeline ────────────────────────────────────────
  const addTl = useCallback((type: TimelineItem['type'], text: string, ts: number | null = null) => {
    if (!ws || !text.trim()) return
    setWs(prev => prev ? { ...prev, timeline: [...prev.timeline, { id: gid(), type, text: text.trim(), timestamp: ts, createdAt: Date.now() }] } : prev)
  }, [ws])

  const rmTl = useCallback((id: string) => {
    setWs(prev => prev ? { ...prev, timeline: prev.timeline.filter(t => t.id !== id) } : prev)
  }, [])

  const seekTo = useCallback((time: number) => {
    try { playerRef.current?.seekTo?.(time, true) } catch {}
    setCurrentTime(time)
    setWs(prev => prev ? { ...prev, activeTimestamp: time } : prev)
  }, [])

  // ─── Export ──────────────────────────────────────────
  const exportW = useCallback((format: 'json' | 'markdown') => {
    if (!ws) return
    let content: string, filename: string, mime: string
    if (format === 'json') {
      content = JSON.stringify(ws, null, 2); filename = `reaction-${ws.videoId}.json`; mime = 'application/json'
    } else {
      content = [
        `# ${ws.metadata.title}`, `**${ws.metadata.channel}**`, '',
        '## Summary', ws.producerBrief?.summary || ws.intelligence?.summary || 'N/A', '',
        '## Central Argument', ws.producerBrief?.centralArgument || 'N/A', '',
        '## Key Moments', ...(ws.intelligence?.keyMoments || []).map((m: any) => `- **${m.timestamp || '—'}** ${m.description}`), '',
        '## Claims', ...(ws.claims?.claims || []).map((c: any) => `- [${c.verdict}] ${c.claim}`), '',
        '## Angles', ...(ws.angles?.angles || []).map((a: any) => `- **${a.name}**: ${a.hook}`), '',
        '## Timeline', ...ws.timeline.map(t => `- [${fmt(t.timestamp)}] [${t.type}] ${t.text}`),
      ].join('\n')
      filename = `reaction-${ws.videoId}.md`; mime = 'text/markdown'
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type: mime })); a.download = filename; a.click()
  }, [ws])

  // ─── Persist ─────────────────────────────────────────
  useEffect(() => { if (ws) try { localStorage.setItem('rp-ws', JSON.stringify(ws)) } catch {} }, [ws])
  useEffect(() => { try { const s = localStorage.getItem('rp-ws'); if (s) setWs(JSON.parse(s)) } catch {} }, [])

  // ─── YouTube Player ─────────────────────────────────
  useEffect(() => {
    if (!ws) return
    if (!(window as any).YT) { const t = document.createElement('script'); t.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(t) }
    const check = setInterval(() => {
      if ((window as any).YT?.Player) {
        clearInterval(check)
        if (playerRef.current) { try { playerRef.current.destroy() } catch {} }
        playerRef.current = new (window as any).YT.Player('yt-player', {
          videoId: ws.videoId, height: '100%', width: '100%',
          playerVars: { autoplay: 0, modestbranding: 1, rel: 0 },
          events: { onReady: () => setPlayerReady(true) },
        })
      }
    }, 200)
    return () => clearInterval(check)
  }, [ws?.videoId])

  // Refresh AI status periodically
  useEffect(() => {
    const refresh = () => fetch('/api/ai-status').then(r => r.json()).then(d => setAiStatus(d)).catch(() => {})
    refresh()
    const iv = setInterval(refresh, 10000)
    return () => clearInterval(iv)
  }, [])

  // ─── RENDER: Settings Modal ──
  const keyStatusEl = aiStatus?.keys?.length > 0 && (
    <div style={{ marginBottom: 16, padding: 12, background: 'var(--bg-tertiary)', borderRadius: 8 }}>
      <h4 style={{ fontSize: 13, marginBottom: 8 }}>🔑 Rotating Keys (api/keys.json)</h4>
      {aiStatus.keys.map((k: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
          <span style={{ color: k.onCooldown ? 'var(--warning)' : 'var(--success)' }}>
            {k.onCooldown ? '⏳' : '✓'} {k.name}
          </span>
          <span style={{ color: 'var(--text-muted)' }}>
            {k.rpmUsed}/{k.rpmLimit || '∞'} rpm
            {' · '}
            {k.dailyUsed}/{k.dailyLimit || '∞'} daily
            {k.cooldownRemaining > 0 && ` · ${k.cooldownRemaining}s cooldown`}
          </span>
        </div>
      ))}
    </div>
  )

  const settingsModal = showSettings && (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, maxWidth: 520, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
        <h3 style={{ marginBottom: 16 }}>⚙️ AI Setup</h3>

        {keyStatusEl}

        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          <b>Best:</b> Edit <code style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>api/keys.json</code> in your project folder — put 2 keys with different accounts and they auto-rotate on rate limits.
        </p>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Free keys at <a href="https://openrouter.ai/keys" target="_blank" style={{ color: 'var(--accent)' }}>openrouter.ai/keys</a> — no credit card. Make 2 accounts, put both keys in.
        </p>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Or add a single key here (fallback if keys.json is empty):</p>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Provider</label>
            <select value={providerType} onChange={e => setProviderType(e.target.value)} style={{ width: '100%', padding: 8, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
            </select>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>API Key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-..." style={{ width: '100%', padding: 8, background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, outline: 'none' }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={saveApiKey}>Save</button>
          <button className="btn btn-secondary" onClick={() => setShowSettings(false)}>Close</button>
        </div>
      </div>
    </div>
  )

  // ─── RENDER: Welcome ──
  if (!ws && !loading) {
    return (
      <div className="app">
        <div className="header">
          <span className="header-logo">R1 Producer</span>
          <div className="url-bar">
            <input className="url-input" placeholder="Paste YouTube URL..." value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && openWorkspace()} autoFocus />
            <button className="btn btn-primary" onClick={openWorkspace} disabled={!url.trim()}>Open</button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>⚙️ {apiKey ? 'AI ✓' : 'Setup AI'}</button>
        </div>
        {error && <div style={{ padding: '12px 20px' }}><div className="error-msg">{error}</div></div>}
        {settingsModal}
        <div className="welcome">
          <h1>R1 Producer</h1>
          <p>Paste any YouTube URL. Get instant analysis — key moments, claims, reaction angles, and a producer chat that understands the video.</p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 800 }}>
            <div className="intel-card" style={{ width: 180, textAlign: 'center' }}><div className="card-title">🎯 Moments</div><div className="card-body">Timestamped highlights worth reacting to</div></div>
            <div className="intel-card" style={{ width: 180, textAlign: 'center' }}><div className="card-title">🔍 Claims</div><div className="card-body">What needs verification</div></div>
            <div className="intel-card" style={{ width: 180, textAlign: 'center' }}><div className="card-title">💡 Angles</div><div className="card-body">Distinct reaction approaches</div></div>
            <div className="intel-card" style={{ width: 180, textAlign: 'center' }}><div className="card-title">🎙️ Chat</div><div className="card-body">AI producer that knows this video</div></div>
          </div>
          {!apiKey && (
            <div style={{ marginTop: 20, padding: '12px 20px', background: 'var(--bg-card)', borderRadius: 8, maxWidth: 500 }}>
              <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 8 }}>⚡ No AI key — using rule-based analysis (works without AI, but AI adds depth)</p>
              <button className="btn btn-primary btn-sm" onClick={() => setShowSettings(true)}>Add Free API Key</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ─── RENDER: Loading ──
  if (loading) {
    return (
      <div className="app">
        <div className="header"><span className="header-logo">R1 Producer</span></div>
        <div className="loading-overlay" style={{ flex: 1 }}><div className="loading-spinner" /><span>{loading}</span></div>
      </div>
    )
  }

  // ─── RENDER: Workspace ──
  const brief = ws!.producerBrief
  const intel = ws!.intelligence
  const vp = ws!.valuePoints
  const cl = ws!.claims
  const ang = ws!.angles
  const res = ws!.research

  return (
    <div className="app">
      <div className="header">
        <span className="header-logo">R1 Producer</span>
        <div className="url-bar">
          <input className="url-input" placeholder="New YouTube URL..." value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && openWorkspace()} />
          <button className="btn btn-primary" onClick={openWorkspace} disabled={!url.trim() || evaluating}>New</button>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {evaluating && <span className="status-badge loading"><div className="loading-spinner" style={{ width: 12, height: 12, borderWidth: 1 }} /> Analyzing</span>}
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)}>{apiKey ? '⚙️' : '🔑 Setup AI'}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => exportW('markdown')}>MD</button>
          <button className="btn btn-ghost btn-sm" onClick={() => exportW('json')}>JSON</button>
        </div>
      </div>
      {settingsModal}
      {error && <div style={{ padding: '4px 20px' }}><div className="error-msg">{error}</div></div>}

      <div className="workspace">
        {/* LEFT: Video + Timeline */}
        <div className="left-panel">
          <div className="video-container">
            <div id="yt-player" style={{ width: '100%', aspectRatio: '16/9' }} />
            <div className="video-overlay">
              <span className="time">{fmt(currentTime)}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => addTl('moment', `Marked at ${fmt(currentTime)}`, currentTime)}>📍</button>
              <div className="segment-controls">
                <button className={`btn btn-sm ${ws!.markIn !== null ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setWs(p => p ? { ...p, markIn: currentTime } : p)}>In {ws!.markIn !== null ? fmt(ws!.markIn) : ''}</button>
                <button className={`btn btn-sm ${ws!.markOut !== null ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setWs(p => p ? { ...p, markOut: currentTime } : p)}>Out {ws!.markOut !== null ? fmt(ws!.markOut) : ''}</button>
                {ws!.markIn !== null && ws!.markOut !== null && (
                  <button className="btn btn-primary btn-sm" onClick={() => setWs(p => p ? { ...p, segments: [...p.segments, { in: p.markIn!, out: p.markOut!, label: `Seg ${p.segments.length + 1}` }], markIn: null, markOut: null } : p)}>Save</button>
                )}
              </div>
            </div>
          </div>

          <div className="metadata-bar">
            <div className="title">{ws!.metadata.title || 'Video'}</div>
            <div className="channel">{ws!.metadata.channel}{ws!.metadata.viewCount ? ` · ${ws!.metadata.viewCount.toLocaleString()} views` : ''}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
              {ws!.transcriptAvailable
                ? <span style={{ color: 'var(--success)' }}>✓ {ws!.transcriptIsAuto ? 'Auto-captions' : 'Captions'}</span>
                : <span style={{ color: 'var(--warning)' }}>✗ No captions</span>
              }
              {ws!.aiAvailable
                ? <span style={{ color: 'var(--success)' }}>✓ AI ({ws!.model})</span>
                : <span style={{ color: 'var(--warning)' }}>⊘ Rule-based (no AI)</span>
              }
              {ws!.segments.length > 0 && <span>{ws!.segments.length} segments</span>}
            </div>
          </div>

          <div className="timeline-section">
            <div className="timeline-header">
              <h3>Timeline ({intel?.keyMoments?.length || 0} moments + {ws!.timeline.length} notes)</h3>
            </div>
            <div className="timeline-list">
              {(intel?.keyMoments || []).map((m: any, i: number) => (
                <div key={`km-${i}`} className="timeline-item type-moment" onClick={() => { if (m.timestamp?.includes(':')) { const [mm, ss] = m.timestamp.split(':').map(Number); seekTo(mm * 60 + ss) } }}>
                  <span className="timestamp">{m.timestamp || '—'}</span>
                  <span className="content">{m.description}</span>
                  <span className="category-tag">{m.significance}</span>
                </div>
              ))}
              {ws!.timeline.map(item => (
                <div key={item.id} className={`timeline-item type-${item.type} ${ws!.activeTimestamp === item.timestamp ? 'active' : ''}`} onClick={() => item.timestamp !== null && seekTo(item.timestamp)}>
                  <span className="timestamp">{fmt(item.timestamp)}</span>
                  <span className="content">{item.text}</span>
                  <span className="category-tag">{item.type}</span>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto', padding: '2px 6px' }} onClick={e => { e.stopPropagation(); rmTl(item.id) }}>×</button>
                </div>
              ))}
            </div>
            <div className="note-input-row">
              <select value={noteType} onChange={e => setNoteType(e.target.value as any)} style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: 4, fontSize: 12 }}>
                <option value="note">Note</option><option value="question">Q</option><option value="moment">!</option>
              </select>
              <input className="note-input" placeholder={`${noteType} at ${fmt(currentTime)}...`} value={noteIn} onChange={e => setNoteIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && noteIn.trim()) { addTl(noteType, noteIn, currentTime); setNoteIn('') } }} />
              <button className="btn btn-primary btn-sm" onClick={() => { if (noteIn.trim()) { addTl(noteType, noteIn, currentTime); setNoteIn('') } }}>+</button>
            </div>
          </div>
        </div>

        {/* RIGHT: Intelligence + Chat */}
        <div className="right-panel">
          <div className="tab-bar">
            <div className={`tab ${tab === 'brief' ? 'active' : ''}`} onClick={() => setTab('brief')}>Brief</div>
            <div className={`tab ${tab === 'moments' ? 'active' : ''}`} onClick={() => setTab('moments')}>Moments</div>
            <div className={`tab ${tab === 'claims' ? 'active' : ''}`} onClick={() => setTab('claims')}>Claims</div>
            <div className={`tab ${tab === 'angles' ? 'active' : ''}`} onClick={() => setTab('angles')}>Angles</div>
            <div className={`tab ${tab === 'research' ? 'active' : ''}`} onClick={() => setTab('research')}>Research</div>
            <div className={`tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>🎙️ Chat</div>
          </div>

          <div className="panel-content">
            {/* BRIEF */}
            {tab === 'brief' && (<>
              <div className="panel-section"><h4>Summary</h4><p>{brief?.summary || intel?.summary || 'No analysis yet.'}</p></div>
              {brief?.centralArgument && <div className="panel-section"><h4>Central Argument</h4><p>{brief.centralArgument}</p></div>}
              {intel?.emotionalArc && <div className="panel-section"><h4>Emotional Arc</h4><p>{intel.emotionalArc}</p></div>}
              {brief?.topMoments?.length > 0 && <div className="panel-section"><h4>Top Moments</h4>{brief.topMoments.map((m: any, i: number) => <div key={i} className="intel-card high"><div className="card-title">{m.timestamp}</div><div className="card-body">{m.description}</div></div>)}</div>}
              {brief?.topAngles?.length > 0 && <div className="panel-section"><h4>Best Angles</h4>{brief.topAngles.map((a: any, i: number) => <div key={i} className="intel-card success"><div className="card-title">{a.name}</div><div className="card-body">{a.hook}</div></div>)}</div>}
              {brief?.researchPriority && <div className="panel-section"><h4>Research</h4><p>{brief.researchPriority}</p></div>}
              {!ws!.aiAvailable && !ws!.transcriptAvailable && (
                <div style={{ marginTop: 16, padding: 12, background: '#f59e0b11', border: '1px solid #f59e0b33', borderRadius: 8 }}>
                  <p style={{ fontSize: 13, color: 'var(--warning)', marginBottom: 8 }}>⚠️ No captions + no AI = limited analysis. For better results:</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>1. <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} style={{ padding: '0 4px' }}>Add a free AI key</button> (deep analysis even without captions)</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>2. Try a video with auto-captions (most popular videos have them)</p>
                  <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>3. Use the timeline to add your own notes as you watch</p>
                </div>
              )}
              {ws!.generatedAt && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>Analyzed {new Date(ws!.generatedAt).toLocaleTimeString()} · {ws!.model}</div>}
            </>)}

            {/* MOMENTS */}
            {tab === 'moments' && (<>
              <div className="panel-section"><h4>Key Moments</h4>
                {(intel?.keyMoments || []).length > 0
                  ? (intel.keyMoments || []).map((m: any, i: number) => <div key={i} className={`intel-card ${m.significance || 'medium'}`}><div className="card-title">{m.timestamp} — {m.significance}</div><div className="card-body">{m.description}</div></div>)
                  : <p style={{ color: 'var(--text-muted)' }}>No key moments detected. {ws!.transcriptAvailable ? 'Try a video with more distinct content shifts.' : 'Captions needed for moment detection — or add your own notes as you watch.'}</p>
                }
              </div>
              {vp?.valuePoints?.length > 0 && <div className="panel-section"><h4>Value Points</h4>{vp.valuePoints.map((v: any, i: number) => <div key={i} className="intel-card"><div className="card-title">{v.point}</div><div className="card-body">{v.why}</div><div className="card-meta"><span>{v.type}</span>{v.researchNeeded && <span style={{ color: 'var(--warning)' }}>🔍</span>}</div></div>)}</div>}
            </>)}

            {/* CLAIMS */}
            {tab === 'claims' && (<div className="panel-section"><h4>Claims & Fact-Check</h4>
              {(cl?.claims || []).length > 0
                ? cl.claims.map((c: any, i: number) => <div key={i} className="intel-card danger"><div className="card-title">{c.claim}</div><div className="card-body">{c.whyItMatters}</div><div className="card-meta"><span className={`verdict ${c.verdict}`}>{c.verdict?.replace('_', ' ')}</span><span>{c.category}</span>{c.timestamp && <span>{c.timestamp}</span>}</div>{c.whatToCheck && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>Check: {c.whatToCheck}</div>}</div>)
                : <p style={{ color: 'var(--text-muted)' }}>{ws!.transcriptAvailable ? 'No strong claims detected.' : 'Captions needed for claim detection. As you watch, note any claims you hear — they\'re your reaction opportunities.'}</p>
              }
            </div>)}

            {/* ANGLES */}
            {tab === 'angles' && (<div className="panel-section"><h4>Reaction Angles</h4>
              {(ang?.angles || []).length > 0
                ? ang.angles.map((a: any, i: number) => <div key={i} className="intel-card success"><div className="card-title">{a.name}</div><div className="card-body"><b>Hook:</b> {a.hook}<br/><b>Angle:</b> {a.angle}<br/><b>Style:</b> {a.style}<br/><b>Payoff:</b> {a.audiencePayoff}</div>{a.researchNeeded?.length > 0 && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 4 }}>Research: {a.researchNeeded.join(', ')}</div>}</div>)
                : <p style={{ color: 'var(--text-muted)' }}>Angles generated from video analysis.</p>
              }
            </div>)}

            {/* RESEARCH */}
            {tab === 'research' && (<div className="panel-section"><h4>Research Items</h4>
              {(res?.researchItems || []).length > 0
                ? res.researchItems.map((r: any, i: number) => <div key={i} className={`intel-card ${r.priority === 'critical' ? 'danger' : r.priority === 'important' ? 'medium' : 'low'}`}><div className="card-title">{r.topic}</div><div className="card-body">{r.why}</div><div className="card-meta"><span className={`verdict ${r.priority === 'critical' ? 'needs_verification' : 'opinion'}`}>{r.priority}</span></div>{r.queries?.length > 0 && <div style={{ fontSize: 12, color: 'var(--info)', marginTop: 4 }}>Search: {r.queries.join(' | ')}</div>}</div>)
                : <p style={{ color: 'var(--text-muted)' }}>No research items identified.</p>
              }
            </div>)}

            {/* CHAT */}
            {tab === 'chat' && (<div className="chat-container">
              <div className="chat-mode-bar">
                {['produce', 'research', 'react', 'improve'].map(mode => (
                  <button key={mode} className={`chat-mode-btn ${ws!.chatMode === mode ? 'active' : ''}`} onClick={() => setWs(p => p ? { ...p, chatMode: mode } : p)}>
                    {mode === 'produce' ? '🎬 Produce' : mode === 'research' ? '🔍 Research' : mode === 'react' ? '⚡ React' : '✨ Improve'}
                  </button>
                ))}
              </div>
              <div className="chat-messages">
                {ws!.chatHistory.length === 0 && (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
                    Ask your producer anything about this video.<br/>
                    <b>Try:</b> "What should I react to?" · "Is this claim true?" · "Give me a stronger angle"<br/><br/>
                    {!apiKey && <span style={{ color: 'var(--warning)' }}>💡 <button className="btn btn-ghost btn-sm" onClick={() => setShowSettings(true)} style={{ padding: '0 4px' }}>Add AI key</button> for deeper answers. Chat works without AI too (rule-based fallback).</span>}
                  </div>
                )}
                {ws!.chatHistory.map((msg, i) => (
                  <div key={i} className={`chat-msg ${msg.role}`}>
                    {msg.content.split('\n').map((line, li) => <span key={li}>{line}<br/></span>)}
                  </div>
                ))}
              </div>
              <div className="chat-input-area">
                <input className="chat-input" placeholder={`Ask (${ws!.chatMode} mode)...`} value={chatIn} onChange={e => setChatIn(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChat()} />
                <button className="btn btn-primary" onClick={sendChat} disabled={!chatIn.trim()}>Send</button>
              </div>
            </div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
