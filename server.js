import express from 'express';
import { createClient } from 'redis';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ─── Redis ───
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (err) => console.error('Redis error:', err));
await redis.connect();
console.log('Conectado a Redis');

// ─── API endpoints ───

// GET config (zones + carriers)
app.get('/api/config', async (req, res) => {
  try {
    const zones = await redis.get('3pl-zones');
    const carriers = await redis.get('3pl-carriers');
    res.json({
      zones: zones ? JSON.parse(zones) : [],
      carriers: carriers ? JSON.parse(carriers) : [],
    });
  } catch (e) {
    console.error('Error leyendo config:', e);
    res.status(500).json({ error: 'Error leyendo config' });
  }
});

// SAVE zones
app.post('/api/zones', async (req, res) => {
  try {
    await redis.set('3pl-zones', JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando zones:', e);
    res.status(500).json({ error: 'Error guardando zones' });
  }
});

// SAVE carriers
app.post('/api/carriers', async (req, res) => {
  try {
    await redis.set('3pl-carriers', JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando carriers:', e);
    res.status(500).json({ error: 'Error guardando carriers' });
  }
});

// ─── Static files ───
app.use(express.static(join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
