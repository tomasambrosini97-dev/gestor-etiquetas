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

// ─── Clients list ───
app.get('/api/clients', async (req, res) => {
  try {
    const list = await redis.get('3pl-clients');
    res.json(list ? JSON.parse(list) : []);
  } catch (e) {
    console.error('Error leyendo clients:', e);
    res.status(500).json({ error: 'Error leyendo clients' });
  }
});

app.post('/api/clients', async (req, res) => {
  try {
    await redis.set('3pl-clients', JSON.stringify(req.body));
    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando clients:', e);
    res.status(500).json({ error: 'Error guardando clients' });
  }
});

// ─── History ───
// Each day is a separate key: 3pl-history-YYYY-MM-DD
// A separate key 3pl-history-dates stores the list of dates with data
app.get('/api/history/dates', async (req, res) => {
  try {
    const dates = await redis.get('3pl-history-dates');
    res.json(dates ? JSON.parse(dates) : []);
  } catch (e) {
    console.error('Error leyendo history dates:', e);
    res.status(500).json({ error: 'Error leyendo history dates' });
  }
});

app.get('/api/history/:date', async (req, res) => {
  try {
    const date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Fecha inválida' });
    const entries = await redis.get(`3pl-history-${date}`);
    res.json(entries ? JSON.parse(entries) : []);
  } catch (e) {
    console.error('Error leyendo history:', e);
    res.status(500).json({ error: 'Error leyendo history' });
  }
});

app.post('/api/history', async (req, res) => {
  try {
    const { date, entry } = req.body;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Fecha inválida' });
    if (!entry) return res.status(400).json({ error: 'Entry requerida' });

    // Append to day's entries
    const key = `3pl-history-${date}`;
    const existing = await redis.get(key);
    const arr = existing ? JSON.parse(existing) : [];
    arr.push(entry);
    await redis.set(key, JSON.stringify(arr));

    // Update dates index
    const datesRaw = await redis.get('3pl-history-dates');
    const dates = datesRaw ? JSON.parse(datesRaw) : [];
    if (!dates.includes(date)) {
      dates.push(date);
      dates.sort((a, b) => b.localeCompare(a)); // newest first
      await redis.set('3pl-history-dates', JSON.stringify(dates));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando history:', e);
    res.status(500).json({ error: 'Error guardando history' });
  }
});

// Delete a history entry (by date + entry id)
app.delete('/api/history/:date/:entryId', async (req, res) => {
  try {
    const { date, entryId } = req.params;
    const key = `3pl-history-${date}`;
    const existing = await redis.get(key);
    if (!existing) return res.json({ ok: true });
    const arr = JSON.parse(existing);
    const filtered = arr.filter((e) => e.id !== entryId);
    if (filtered.length === 0) {
      await redis.del(key);
      // Remove from dates index
      const datesRaw = await redis.get('3pl-history-dates');
      if (datesRaw) {
        const dates = JSON.parse(datesRaw).filter((d) => d !== date);
        await redis.set('3pl-history-dates', JSON.stringify(dates));
      }
    } else {
      await redis.set(key, JSON.stringify(filtered));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Error borrando history:', e);
    res.status(500).json({ error: 'Error borrando history' });
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
