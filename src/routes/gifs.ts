import { Router } from 'express';

const router = Router();

const GIPHY_KEY = process.env.GIPHY_API_KEY || 'dc6zaTOxFJmzC';

const FALLBACK_GIFS = [
  { id: 'f1', url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif', title: 'Happy dance' },
  { id: 'f2', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', title: 'Thumbs up' },
  { id: 'f3', url: 'https://media.giphy.com/media/26BRuo6sKon-oqU6E/giphy.gif', title: 'Clapping' },
  { id: 'f4', url: 'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif', title: 'Excited' },
  { id: 'f5', url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', title: 'Love' },
  { id: 'f6', url: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif', title: 'LOL' },
  { id: 'f7', url: 'https://media.giphy.com/media/3o6Zt4HU6M8gJ5vqJW/giphy.gif', title: 'Wow' },
  { id: 'f8', url: 'https://media.giphy.com/media/26ufdipQqU2lh0NAI/giphy.gif', title: 'Cool' },
  { id: 'f9', url: 'https://media.giphy.com/media/3o7btPCcdNniyf0ArS/giphy.gif', title: 'Thinking' },
  { id: 'f10', url: 'https://media.giphy.com/media/l0HlNQ03J5JxX6lva/giphy.gif', title: 'Party' },
  { id: 'f11', url: 'https://media.giphy.com/media/26BRv0ThflsHCqDrG/giphy.gif', title: 'Bye' },
  { id: 'f12', url: 'https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif', title: 'Yes' },
];

async function fetchGiphy(endpoint: string) {
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/${endpoint}&api_key=${GIPHY_KEY}&rating=g`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.data || []).map((g: { id: string; title: string; images: { fixed_height_small: { url: string } } }) => ({
      id: g.id,
      url: g.images.fixed_height_small.url,
      title: g.title || 'GIF',
    }));
  } catch {
    return null;
  }
}

router.get('/trending', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 24, 30);
  const gifs = await fetchGiphy(`trending?limit=${limit}`);
  res.json({ gifs: gifs?.length ? gifs : FALLBACK_GIFS.slice(0, limit) });
});

router.get('/search', async (req, res) => {
  const q = (req.query.q as string)?.trim();
  const limit = Math.min(Number(req.query.limit) || 24, 30);
  if (!q) return res.json({ gifs: FALLBACK_GIFS.slice(0, limit) });

  const gifs = await fetchGiphy(`search?q=${encodeURIComponent(q)}&limit=${limit}`);
  if (gifs?.length) return res.json({ gifs });

  const filtered = FALLBACK_GIFS.filter((g) => g.title.toLowerCase().includes(q.toLowerCase()));
  res.json({ gifs: filtered.length ? filtered : FALLBACK_GIFS.slice(0, limit) });
});

export default router;
