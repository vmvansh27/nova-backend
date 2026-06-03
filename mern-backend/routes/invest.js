const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Investment = require('../models/Investment');
const Transaction = require('../models/Transaction');
const AdminSettings = require('../models/AdminSettings');

function isWindowOpen() {
  const h = new Date().getHours();
  return h < 12 || h >= 17;
}

router.post('/', auth, body('amount').isFloat({ gt: 0 }), async (req, res) => {
  const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
  if (!isWindowOpen()) return res.status(400).json({ error: 'Window closed (12 PM - 5 PM)' });
  const { amount } = req.body;
  const settings = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
  if (amount < settings.investmentMinAmount) return res.status(400).json({ error: `Min $${settings.investmentMinAmount}` });
  if (amount > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  const roi = settings.defaultRoi;
  const expectedReturn = +(amount * (1 + roi / 100)).toFixed(4);
  const matures = new Date(); matures.setDate(matures.getDate() + 1); matures.setHours(6, 0, 0, 0);

  req.user.balance -= amount;
  req.user.invested += amount;
  await req.user.save();

  const inv = await Investment.create({ user: req.user._id, amount, roi, expectedReturn, maturesAt: matures });
  await Transaction.create({ user: req.user._id, type: 'investment', amount, status: 'active' });
  res.json({ ok: true, investment: inv });
});

router.get('/mine', auth, async (req, res) => {
  res.json(await Investment.find({ user: req.user._id }).sort('-createdAt'));
});

// Cron job (call this on a schedule) to mature investments and credit profits.
router.post('/run-maturity-cron', async (req, res) => {
  if (req.headers['x-cron-key'] !== process.env.JWT_SECRET) return res.status(401).end();
  const due = await Investment.find({ status: 'active', maturesAt: { $lte: new Date() } });
  const User = require('../models/User');
  for (const inv of due) {
    const user = await User.findById(inv.user);
    if (!user) continue;
    user.balance += inv.expectedReturn;
    user.invested -= inv.amount;
    user.profit += inv.expectedReturn - inv.amount;
    await user.save();
    inv.status = 'matured'; await inv.save();
    await Transaction.create({ user: user._id, type: 'profit', amount: inv.expectedReturn - inv.amount, status: 'completed' });
  }
  res.json({ matured: due.length });
});

module.exports = router;
