const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const { auth } = require('../middleware/auth');
const Investment = require('../models/Investment');
const InvestmentPlan = require('../models/InvestmentPlan');
const Transaction = require('../models/Transaction');
const AdminSettings = require('../models/AdminSettings');

function isWindowOpen() {
  const h = new Date().getHours();
  return h < 12 || h >= 17;
}

async function ensureDefaultPlans() {
  const existing = await InvestmentPlan.countDocuments();
  if (existing > 0) return;
  await InvestmentPlan.insertMany([
    { name: 'Starter 10', amount: 10, roi: 1.5, order: 1 },
    { name: 'Starter 20', amount: 20, roi: 1.5, order: 2 },
    { name: 'Growth 50', amount: 50, roi: 1.8, order: 3 },
    { name: 'Growth 100', amount: 100, roi: 2.0, order: 4 },
    { name: 'Pro 250', amount: 250, roi: 2.3, order: 5 },
    { name: 'Pro 500', amount: 500, roi: 2.6, order: 6 },
    { name: 'Elite 1000', amount: 1000, roi: 3.0, order: 7 },
  ]);
}

router.get('/plans', auth, async (_req, res) => {
  await ensureDefaultPlans();
  res.json(await InvestmentPlan.find({ active: true }).sort({ order: 1, amount: 1 }));
});

router.post('/', auth, body('amount').optional().isFloat({ gt: 0 }), body('planId').optional().isString(), async (req, res) => {
  const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
  if (!isWindowOpen()) return res.status(400).json({ error: 'Window closed (12 PM - 5 PM)' });
  await ensureDefaultPlans();
  const selectedPlan = req.body.planId ? await InvestmentPlan.findById(req.body.planId) : null;
  if (req.body.planId && !selectedPlan) return res.status(404).json({ error: 'Investment plan not found' });
  const amount = selectedPlan ? selectedPlan.amount : Number(req.body.amount);
  const settings = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
  if (amount < settings.investmentMinAmount) return res.status(400).json({ error: `Min $${settings.investmentMinAmount}` });
  if (amount > req.user.balance) return res.status(400).json({ error: 'Insufficient balance' });

  const roi = selectedPlan ? selectedPlan.roi : settings.defaultRoi;
  const expectedReturn = +(amount * (1 + roi / 100)).toFixed(4);
  const matures = new Date(); matures.setDate(matures.getDate() + 1); matures.setHours(6, 0, 0, 0);

  req.user.balance -= amount;
  req.user.invested += amount;
  await req.user.save();

  const inv = await Investment.create({ user: req.user._id, plan: selectedPlan?._id, amount, roi, expectedReturn, maturesAt: matures });
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
