const { Schema, model } = require('mongoose');
module.exports = model('NFT', new Schema({
  name: { type: String, required: true },
  artist: String,
  description: String,
  image: String,
  price: { type: Number, required: true },
  currency: { type: String, default: 'BNB' },
  owner: { type: Schema.Types.ObjectId, ref: 'User' },
  listed: { type: Boolean, default: true },
  tokenId: String,
  contractAddress: String,
}, { timestamps: true }));
