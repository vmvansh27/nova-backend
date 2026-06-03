const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Referral = require('../models/Referral');
const AdminSettings = require('../models/AdminSettings');
const { sign } = require('../utils/jwt');
const { generateOtp } = require('../utils/otp');
const { sendOtp } = require('../utils/mailer');
const { generateDepositAddress } = require('../utils/bsc');
const { otpLimiter } = require('../middleware/rateLimit');

router.post('/request-otp', otpLimiter,
  body('email').isEmail(),
  async (req, res) => {
    const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const email = req.body.email.toLowerCase();
    const isDemoMode = process.env.DEMO_MODE === 'true';
    const isAdmin = email === (process.env.ADMIN_EMAIL || '').toLowerCase();
    const code = isDemoMode ? (process.env.DEMO_OTP_CODE || '123456') : generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await User.findOneAndUpdate({ email }, { email, ...(isAdmin ? { isAdmin: true } : {}), otp: { code, expiresAt } }, { upsert: true });
    if (!isDemoMode) {
      try { await sendOtp(email, code); } catch (e) { console.error('mail error', e.message); }
    }
    res.json({ ok: true, demoCode: isDemoMode ? code : undefined });
  }
);

router.post('/verify-otp',
  body('email').isEmail(),
  body('code').isLength({ min: 6, max: 6 }),
  body('referralCode').optional().isString(),
  async (req, res) => {
    const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const { email, code, referralCode } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.otp?.code) return res.status(400).json({ error: 'No OTP requested' });
    if (user.otp.code !== code || user.otp.expiresAt < new Date()) return res.status(400).json({ error: 'Invalid or expired OTP' });

    let isNew = !user.referralCode;
    if (isNew) {
      const settings = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
      user.referralCode = 'REF' + Math.random().toString(36).slice(2, 8).toUpperCase();
      user.walletAddress = generateDepositAddress(user._id);
      user.balance = settings.signupBonus;
      await Transaction.create({ user: user._id, type: 'signup_bonus', amount: settings.signupBonus, status: 'completed' });

      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer && referrer._id.toString() !== user._id.toString()) {
          const reward = +(settings.signupBonus * settings.referralBonusPercent / 100).toFixed(4);
          user.referredBy = referrer._id;
          referrer.balance += reward;
          referrer.referralEarnings += reward;
          await referrer.save();
          await Referral.create({ referrer: referrer._id, referred: user._id, reward });
          await Transaction.create({ user: referrer._id, type: 'referral', amount: reward, status: 'completed', note: `Referral reward for ${user.email}` });
        }
      }
    }
    user.otp = undefined;
    await user.save();

    const token = sign(user._id.toString());
    res.json({ token, user: { id: user._id, email: user.email, name: user.name || user.email.split('@')[0], isAdmin: user.isAdmin, referralCode: user.referralCode, walletAddress: user.walletAddress, balance: user.balance } });
  }
);

module.exports = router;
