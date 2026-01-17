import { parseUnits } from "viem";
import { getWalletClient, getChainId, switchChain } from "@wagmi/core";
import { config } from "./config";

const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",      // Ethereum
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",  // Arbitrum
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",   // Base
};

// ERC-20 token standard - functions to interact with USDC
const ERC20_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
/**
 * Send USDC with automatic network check
 */
export async function sendUSDC(
  toAddress: `0x${string}`,
  amount: string,
  requiredChainId: number = 42161
) {
  // Check current network
  const currentChainId = getChainId(config);
  
  if (currentChainId !== requiredChainId) {
    // Prompt user to switch networks
    await switchChain(config, { chainId: requiredChainId as 1 | 42161 | 8453 });
  }

  // Get wallet client
  const walletClient = await getWalletClient(config, { chainId: requiredChainId });
  
  if (!walletClient) {
    throw new Error("Wallet not connected");
  }

  const usdcAddress = USDC_ADDRESSES[requiredChainId];
  if (!usdcAddress) {
    throw new Error(`USDC not supported on chain ${requiredChainId}`);
  }

  const amountInUnits = parseUnits(amount, 6);

  const hash = await walletClient.writeContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [toAddress, amountInUnits],
  });

  return hash;
}