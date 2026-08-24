import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchVideoMetadata } from './routes/video-metadata.mjs';
import { fetchTranscript } from './routes/transcript.mjs';
import { handleEvaluate } from './routes/evaluate.mjs';
import { handleChat } from './routes/chat.mjs';
import { getProviderInfo, setRuntimeApiKey, setRuntimeProvider } from './ai/provider.mjs';
import { getStatus, configuredCount } from '../api/key-rotation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());

app.use((req, _res, next) => {
  const key = req.headers['x-ai-key'];
  const provider = req.headers['x-ai-provider'];
  setRuntimeApiKey(key && typeof key === 'string' ? key : null);
  setRuntimeProvider(provider && typeof provider === 'string' ? provider : null);
  next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  const provider = getProviderInfo();
  res.json({ status: 'ok', time: new Date().toISOString(), ai: provider });
});

app.get('/api/ai-status', (_req, res) => {
  res.json({
    ...getProviderInfo(),
    keys: getStatus(),
  });
});

app.get('/api/video-metadata', async (req, res) => {
  try {
    const videoId = req.query.videoId;
    if (!videoId) return res.status(400).json({ error: 'videoId required' });
    const data = await fetchVideoMetadata(videoId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch video metadata' });
  }
});

app.get('/api/transcript', async (req, res) => {
  try {
    const videoId = req.query.videoId;
    if (!videoId) return res.status(400).json({ error: 'videoId required' });
    const data = await fetchTranscript(videoId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to fetch transcript' });
  }
});

app.post('/api/evaluate', async (req, res) => {
  try {
    const result = await handleEvaluate(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Evaluation failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const result = await handleChat(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Chat failed' });
  }
});

// Serve built frontend
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));
app.get('*', (_req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(Number(PORT), '0.0.0.0', () => {
  const p = getProviderInfo();
  console.log(`🚀 R1 Producer running on http://localhost:${PORT}`);
  console.log(`🔑 API Keys: ${p.message}`);
});
