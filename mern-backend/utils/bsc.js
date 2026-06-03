const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);

// Verify an on-chain BEP20 deposit by txHash:
// Returns { ok, from, to, value, confirmations }
exports.verifyDeposit = async (txHash) => {
  const tx = await provider.getTransaction(txHash);
  if (!tx) return { ok: false, reason: 'tx not found' };
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return { ok: false, reason: 'tx failed' };
  const block = await provider.getBlockNumber();
  const confirmations = block - receipt.blockNumber;
  if (confirmations < (+process.env.BSC_CONFIRMATIONS || 3)) return { ok: false, reason: 'not enough confirmations' };
  return {
    ok: true,
    from: tx.from,
    to: tx.to,
    value: Number(ethers.formatEther(tx.value)),
    confirmations,
  };
};

// Generate a fresh deposit address for a user. In production you would
// derive from an HD wallet (e.g. ethers.HDNodeWallet) using the user's id
// as a derivation index, and forward funds to ADMIN_WALLET_ADDRESS via
// a sweeper service. For now we return a placeholder.
exports.generateDepositAddress = (userId) => {
  // Replace with HD-wallet derivation in production.
  return ethers.Wallet.createRandom().address;
};
