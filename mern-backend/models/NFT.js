const { Schema, model } = require('mongoose');
module.exports = model('NFT', new Schema({
  name: { type: String, required: true },
  artist: String,
  description: String,
  image: String,
  price: { type: Number, required: true },
  currency: { type: String, default: 'BNB' },
  durationDays: { type: Number, default: 0 },
  interestPercent: { type: Number, default: 0 },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  listed: { type: Boolean, default: true },
  tokenId: String,
  contractAddress: String,
}, { timestamps: true }));
