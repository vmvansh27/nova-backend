const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Referral = require('../models/Referral');
const AdminSettings = require('../models/AdminSettings');
const { sign } = require('../utils/jwt');
const { generateOtp } = require('../utils/otp');
const { sendOtp } = require('../utils/mailer');
const { generateDepositAddress, getPlatformDepositAddress } = require('../utils/bsc');
const { otpLimiter } = require('../middleware/rateLimit');

function getDemoOtpEmails() {
  return (process.env.DEMO_OTP_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isDemoOtpEmail(email) {
  return getDemoOtpEmails().includes((email || '').toLowerCase());
}

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

router.post('/request-otp', otpLimiter,
  body('email').isEmail(),
  async (req, res) => {
    const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const email = normalizeEmail(req.body.email);
    const isDemoMode = process.env.DEMO_MODE === 'true';
    const useDemoOtp = isDemoMode || isDemoOtpEmail(email);
    const isAdmin = email === (process.env.ADMIN_EMAIL || '').toLowerCase();
    const code = useDemoOtp ? (process.env.DEMO_OTP_CODE || '123456') : generateOtp();
    console.log('[auth][request-otp]', { email, isDemoMode, useDemoOtp, isAdmin });
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await User.findOneAndUpdate({ email }, { email, ...(isAdmin ? { isAdmin: true } : {}), otp: { code, expiresAt } }, { upsert: true });
    if (!useDemoOtp) {
      try { await sendOtp(email, code); } catch (e) { console.error('mail error', e.message); }
    }
    res.json({ ok: true, demoCode: useDemoOtp ? code : undefined });
  }
);

router.post('/verify-otp',
  body('email').isEmail(),
  body('code').isLength({ min: 6, max: 6 }),
  body('referralCode').optional().isString(),
  async (req, res) => {
    const errs = validationResult(req); if (!errs.isEmpty()) return res.status(400).json({ errors: errs.array() });
    const email = normalizeEmail(req.body.email);
    const code = (req.body.code || '').trim();
    const { referralCode } = req.body;
    const user = await User.findOne({ email });
    if (!user || !user.otp?.code) return res.status(400).json({ error: 'No OTP requested' });
    const isDemoCodeAllowed = isDemoOtpEmail(email) && code === (process.env.DEMO_OTP_CODE || '123456');
    const isStoredCodeValid = user.otp.code === code && user.otp.expiresAt >= new Date();
    if (!isStoredCodeValid && !isDemoCodeAllowed) return res.status(400).json({ error: 'Invalid or expired OTP' });

    let isNew = !user.referralCode;
    if (isNew) {
      const settings = (await AdminSettings.findOne({ key: 'global' })) || await AdminSettings.create({ key: 'global' });
      user.referralCode = 'REF' + Math.random().toString(36).slice(2, 8).toUpperCase();
      user.walletAddress = generateDepositAddress();
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
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        name: user.name || user.email.split('@')[0],
        isAdmin: user.isAdmin,
        referralCode: user.referralCode,
        walletAddress: getPlatformDepositAddress(),
        platformWalletAddress: getPlatformDepositAddress(),
        assetMode: (process.env.WALLET_ASSET_MODE || 'native').toLowerCase(),
        balance: user.balance,
      },
    });
  }
);

module.exports = router;
