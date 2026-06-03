const router = require('express').Router();
const { auth, admin } = require('../middleware/auth');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const AdminSettings = require('../models/AdminSettings');

router.use(auth, admin);

router.get('/users', async (_req, res) => res.json(await User.find().select('-otp').sort('-createdAt')));

router.get('/settings', async (_req, res) => {
  const s = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
  res.json(s);
});

router.put('/settings', async (req, res) => {
  const s = await AdminSettings.findOneAndUpdate({ key: 'global' }, req.body, { upsert: true, new: true });
  res.json(s);
});

router.get('/withdrawals', async (_req, res) => {
  res.json(await Withdrawal.find().populate('user', 'email').sort('-createdAt'));
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  const w = await Withdrawal.findById(req.params.id);
  if (!w) return res.status(404).end();
  if (w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal already reviewed' });
  w.status = 'approved'; w.reviewedBy = req.user._id; w.reviewedAt = new Date();
  await w.save();
  await Transaction.findOneAndUpdate({ user: w.user, type: 'withdraw', amount: w.amount, status: 'pending' }, { status: 'completed' });
  res.json({ ok: true });
});

router.post('/withdrawals/:id/reject', async (req, res) => {
  const w = await Withdrawal.findById(req.params.id);
  if (!w) return res.status(404).end();
  if (w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal already reviewed' });
  w.status = 'rejected'; w.reviewedBy = req.user._id; w.reviewedAt = new Date();
  await w.save();
  // refund
  const user = await User.findById(w.user); user.balance += w.amount; await user.save();
  await Transaction.findOneAndUpdate({ user: w.user, type: 'withdraw', amount: w.amount, status: 'pending' }, { status: 'rejected' });
  res.json({ ok: true });
});

router.get('/analytics', async (_req, res) => {
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const chartStart = new Date(todayStart); chartStart.setDate(chartStart.getDate() - 6);
  const [users, totalBalance, totalInvested, txCount, transactionTotals, dailyFlow] = await Promise.all([
    User.countDocuments(),
    User.aggregate([{ $group: { _id: null, sum: { $sum: '$balance' } } }]),
    User.aggregate([{ $group: { _id: null, sum: { $sum: '$invested' } } }]),
    Transaction.countDocuments(),
    Transaction.aggregate([
      { $match: { type: { $in: ['deposit', 'withdraw'] }, status: { $ne: 'rejected' }, createdAt: { $gte: sevenDaysAgo } } },
      { $group: {
        _id: '$type',
        daily: { $sum: { $cond: [{ $gte: ['$createdAt', todayStart] }, '$amount', 0] } },
        sevenDays: { $sum: '$amount' },
      } },
    ]),
    Transaction.aggregate([
      { $match: { type: { $in: ['deposit', 'withdraw'] }, status: { $ne: 'rejected' }, createdAt: { $gte: chartStart } } },
      { $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          type: '$type',
        },
        amount: { $sum: '$amount' },
      } },
      { $sort: { '_id.date': 1 } },
    ]),
  ]);
  const totalsFor = (type) => transactionTotals.find((item) => item._id === type) || {};
  const flowByDay = new Map();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(chartStart); day.setDate(day.getDate() + offset);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    flowByDay.set(date, { date, deposits: 0, withdrawals: 0 });
  }
  for (const item of dailyFlow) {
    const day = flowByDay.get(item._id.date);
    if (day) day[item._id.type === 'deposit' ? 'deposits' : 'withdrawals'] = item.amount;
  }
  res.json({
    users,
    platformBalance: totalBalance[0]?.sum || 0,
    totalAccountsBalance: totalBalance[0]?.sum || 0,
    totalInvested: totalInvested[0]?.sum || 0,
    transactions: txCount,
    dailyDeposits: totalsFor('deposit').daily || 0,
    dailyWithdrawals: totalsFor('withdraw').daily || 0,
    sevenDayDeposits: totalsFor('deposit').sevenDays || 0,
    sevenDayWithdrawals: totalsFor('withdraw').sevenDays || 0,
    dailyFlow: Array.from(flowByDay.values()),
  });
});

module.exports = router;
