const { Schema, model } = require('mongoose');
module.exports = model('Withdrawal', new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  address: { type: String, required: true },
  status: { type: String, enum: ['pending','approved','rejected','processed'], default: 'pending' },
  txHash: String,
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  reviewedAt: Date,
}, { timestamps: true }));
