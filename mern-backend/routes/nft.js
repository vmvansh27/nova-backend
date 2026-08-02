const router = require('express').Router();
const { auth } = require('../middleware/auth');
const NFT = require('../models/NFT');
const Transaction = require('../models/Transaction');

router.get('/', async (_req, res) => res.json(await NFT.find({ listed: true })));

router.get('/mine', auth, async (req, res) => {
  res.json(await NFT.find({ owner: req.user._id }).sort('-updatedAt'));
});

router.get('/:id', async (req, res) => res.json(await NFT.findById(req.params.id)));

router.post('/buy/:id', auth, async (req, res) => {
  const nft = await NFT.findById(req.params.id);
  if (!nft || !nft.listed) return res.status(404).json({ error: 'NFT not available' });
  if (nft.price > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });
  req.user.balance -= nft.price;
  await req.user.save();
  nft.owner = req.user._id;
  nft.listed = false;
  await nft.save();
  await Transaction.create({
    user: req.user._id,
    type: 'investment',
    amount: nft.price,
    status: 'completed',
    note: `NFT purchase: ${nft.name}`,
  });
  res.json({ ok: true, nft });
});

module.exports = router;
