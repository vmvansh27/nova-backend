const router = require('express').Router();
const { auth } = require('../middleware/auth');
const NFT = require('../models/NFT');

router.get('/', async (_req, res) => res.json(await NFT.find({ listed: true })));
router.get('/:id', async (req, res) => res.json(await NFT.findById(req.params.id)));
router.post('/buy/:id', auth, async (req, res) => {
  const nft = await NFT.findById(req.params.id);
  if (!nft || !nft.listed) return res.status(404).json({ error: 'NFT not available' });
  // Simulation only — real impl would settle on-chain
  nft.owner = req.user._id; nft.listed = false; await nft.save();
  res.json({ ok: true, nft });
});

module.exports = router;
