import { Router } from 'express';
import { streamGridFSFile } from '../services/gridfs.js';

const router = Router();

router.get('/:id', async (req, res) => {
  const ok = await streamGridFSFile(String(req.params.id), res);
  if (!ok) res.status(404).json({ error: 'File not found' });
});

export default router;
