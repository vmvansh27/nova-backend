const { Schema, model } = require('mongoose');
module.exports = model('AdminSettings', new Schema({
  key: { type: String, unique: true },
  defaultRoi: { type: Number, default: 1.5 },
  referralBonusPercent: { type: Number, default: 5 },
  signupBonus: { type: Number, default: 5 },
  investmentMinAmount: { type: Number, default: 10 },
  adminWallet: String,
}, { timestamps: true }));
