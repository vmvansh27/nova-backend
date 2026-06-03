const router = require('express').Router();
const { auth } = require('../middleware/auth');
const Investment = require('../models/Investment');
const Transaction = require('../models/Transaction');

router.get('/me', auth, async (req, res) => {
  const investments = await Investment.find({ user: req.user._id, status: 'active' }).sort('-createdAt');
  const txs = await Transaction.find({ user: req.user._id }).sort('-createdAt').limit(20);
  res.json({
    user: req.user,
    balance: req.user.balance,
    invested: req.user.invested,
    profit: req.user.profit,
    referralEarnings: req.user.referralEarnings,
    investments, transactions: txs,
  });
});

module.exports = router;
