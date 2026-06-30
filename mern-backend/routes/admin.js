const router = require('express').Router();
const { auth, admin } = require('../middleware/auth');
const User = require('../models/User');
const Withdrawal = require('../models/Withdrawal');
const Transaction = require('../models/Transaction');
const AdminSettings = require('../models/AdminSettings');
const WalletLog = require('../models/WalletLog');
const NFT = require('../models/NFT');
const Post = require('../models/Post');
const Notification = require('../models/Notification');
const KycSubmission = require('../models/KycSubmission');
const InvestmentPlan = require('../models/InvestmentPlan');
const { sendWithdrawal } = require('../utils/bsc');

router.use(auth, admin);

router.get('/users', async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = search ? { email: { $regex: search, $options: 'i' } } : {};
  res.json(await User.find(filter).select('-otp').sort('-createdAt'));
});

router.post('/users/:id/adjust-balance', async (req, res) => {
  const amount = Number(req.body.amount);
  const reason = (req.body.reason || 'Admin balance adjustment').trim();
  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: 'Adjustment amount must be a non-zero number' });
  }
  const target = await User.findById(req.params.id);
  if (!target) return res.status(404).end();
  const nextBalance = +(target.balance + amount).toFixed(4);
  if (nextBalance < 0) return res.status(400).json({ error: 'Adjustment would make balance negative' });
  target.balance = nextBalance;
  await target.save();
  const tx = await Transaction.create({
    user: target._id,
    type: amount > 0 ? 'deposit' : 'withdraw',
    amount: Math.abs(amount),
    status: 'completed',
    note: `${reason} (admin:${req.user.email})`,
  });
  res.json({ ok: true, balance: target.balance, transaction: tx });
});

router.get('/settings', async (_req, res) => {
  const s = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
  res.json(s);
});

router.get('/investment-plans', async (_req, res) => {
  const plans = await InvestmentPlan.find().sort({ order: 1, amount: 1 });
  res.json(plans);
});

router.post('/investment-plans', async (req, res) => {
  const plan = await InvestmentPlan.create(req.body);
  res.json(plan);
});

router.put('/investment-plans/:id', async (req, res) => {
  const plan = await InvestmentPlan.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!plan) return res.status(404).end();
  res.json(plan);
});

router.delete('/investment-plans/:id', async (req, res) => {
  const plan = await InvestmentPlan.findByIdAndDelete(req.params.id);
  if (!plan) return res.status(404).end();
  res.json({ ok: true });
});

router.put('/settings', async (req, res) => {
  const s = await AdminSettings.findOneAndUpdate({ key: 'global' }, req.body, { upsert: true, new: true });
  res.json(s);
});

router.get('/withdrawals', async (_req, res) => {
  res.json(await Withdrawal.find().populate('user', 'email').sort('-createdAt'));
});

router.get('/nfts', async (_req, res) => {
  res.json(await NFT.find().populate('owner', 'email').sort('-createdAt'));
});

router.post('/nfts', async (req, res) => {
  const nft = await NFT.create({ ...req.body, createdBy: req.user._id });
  res.json(nft);
});

router.put('/nfts/:id', async (req, res) => {
  const nft = await NFT.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!nft) return res.status(404).end();
  res.json(nft);
});

router.delete('/nfts/:id', async (req, res) => {
  const nft = await NFT.findByIdAndDelete(req.params.id);
  if (!nft) return res.status(404).end();
  res.json({ ok: true });
});

router.get('/posts', async (_req, res) => {
  res.json(await Post.find().sort('-createdAt'));
});

router.post('/posts', async (req, res) => {
  const post = await Post.create({ ...req.body, createdBy: req.user._id });
  res.json(post);
});

router.put('/posts/:id', async (req, res) => {
  const post = await Post.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!post) return res.status(404).end();
  res.json(post);
});

router.delete('/posts/:id', async (req, res) => {
  const post = await Post.findByIdAndDelete(req.params.id);
  if (!post) return res.status(404).end();
  res.json({ ok: true });
});

router.get('/notifications', async (_req, res) => {
  res.json(await Notification.find().sort('-createdAt'));
});

router.post('/notifications', async (req, res) => {
  const notification = await Notification.create({ ...req.body, createdBy: req.user._id });
  res.json(notification);
});

router.put('/notifications/:id', async (req, res) => {
  const notification = await Notification.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!notification) return res.status(404).end();
  res.json(notification);
});

router.delete('/notifications/:id', async (req, res) => {
  const notification = await Notification.findByIdAndDelete(req.params.id);
  if (!notification) return res.status(404).end();
  res.json({ ok: true });
});

router.get('/kyc', async (_req, res) => {
  res.json(await KycSubmission.find().populate('user', 'email kycStatus').sort('-updatedAt'));
});

router.post('/kyc/:id/approve', async (req, res) => {
  const submission = await KycSubmission.findById(req.params.id);
  if (!submission) return res.status(404).end();
  submission.status = 'approved';
  submission.rejectionReason = undefined;
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  await submission.save();
  await User.findByIdAndUpdate(submission.user, { kycStatus: 'approved' });
  res.json({ ok: true, submission });
});

router.post('/kyc/:id/reject', async (req, res) => {
  const submission = await KycSubmission.findById(req.params.id);
  if (!submission) return res.status(404).end();
  submission.status = 'rejected';
  submission.rejectionReason = req.body.reason || 'KYC details did not pass review';
  submission.reviewedBy = req.user._id;
  submission.reviewedAt = new Date();
  await submission.save();
  await User.findByIdAndUpdate(submission.user, { kycStatus: 'rejected' });
  res.json({ ok: true, submission });
});

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const w = await Withdrawal.findById(req.params.id);
    if (!w) return res.status(404).end();
    if (w.status !== 'pending') return res.status(400).json({ error: 'Withdrawal already reviewed' });
    const transfer = process.env.DEMO_MODE === 'true'
      ? { hash: 'demo-' + Date.now(), status: 'processed' }
      : await sendWithdrawal({ to: w.address, amount: w.amount });
    if (transfer.status !== 'processed') return res.status(502).json({ error: 'Blockchain withdrawal failed' });
    w.status = 'processed'; w.txHash = transfer.hash; w.reviewedBy = req.user._id; w.reviewedAt = new Date();
    await w.save();
    await WalletLog.create({ user: w.user, direction: 'out', amount: w.amount, hash: transfer.hash, to: w.address, status: 'confirmed' });
    await Transaction.findOneAndUpdate({ user: w.user, type: 'withdraw', amount: w.amount, status: 'pending' }, { status: 'completed', hash: transfer.hash });
    res.json({ ok: true, txHash: transfer.hash });
  } catch (error) {
    console.error('[admin][approve-withdrawal]', error.message);
    const status = /HOT_WALLET_PRIVATE_KEY|required|Invalid withdrawal address|TOKEN_CONTRACT_ADDRESS/i.test(error.message) ? 400 : 500;
    res.status(status).json({ error: error.message || 'Withdrawal approval failed' });
  }
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
