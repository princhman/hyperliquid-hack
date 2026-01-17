import { parseUnits } from "viem";
import { getWalletClient, getAccount, switchChain } from "@wagmi/core";
import { config, DEFAULT_CHAIN_ID, TREASURY_ADDRESS } from "./wagmi";

const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  1: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", // Ethereum
  42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Arbitrum
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // Base
};

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

export type PaymentResult = {
  hash: string;
  amount: string;
  chainId: number;
};

/**
 * Send USDC buy-in payment to treasury
 */
export async function sendBuyIn(
  amount: number,
  requiredChainId: number = DEFAULT_CHAIN_ID
): Promise<PaymentResult> {
  const amountStr = amount.toString();
  console.log("sendBuyIn called with:", { amount: amountStr, requiredChainId });

  const account = getAccount(config);

  if (!account.isConnected || !account.address) {
    throw new Error("Wallet not connected. Please connect your wallet first.");
  }

  const currentChainId = account.chainId;

  // Switch network if needed
  if (currentChainId !== requiredChainId) {
    console.log("Switching to chain:", requiredChainId);
    try {
      await switchChain(config, {
        chainId: requiredChainId as 1 | 42161 | 8453,
      });
    } catch {
      throw new Error(
        `Please switch to the correct network in your wallet (Chain ID: ${requiredChainId})`
      );
    }
  }

  const walletClient = await getWalletClient(config, {
    chainId: requiredChainId,
  });

  if (!walletClient) {
    throw new Error(
      "Failed to get wallet client. Please reconnect your wallet."
    );
  }

  const usdcAddress = USDC_ADDRESSES[requiredChainId];
  if (!usdcAddress) {
    throw new Error(`USDC not supported on chain ${requiredChainId}`);
  }

  // USDC has 6 decimals
  const amountInUnits = parseUnits(amountStr, 6);

  try {
    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [TREASURY_ADDRESS, amountInUnits],
    });

    console.log("Transaction sent! Hash:", hash);
    return {
      hash,
      amount: amountStr,
      chainId: requiredChainId,
    };
  } catch (txError) {
    console.error("Transaction failed:", txError);

    if (txError instanceof Error) {
      if (txError.message.includes("insufficient funds")) {
        throw new Error("Insufficient USDC balance");
      } else if (txError.message.includes("user rejected")) {
        throw new Error("Transaction rejected by user");
      }
    }

    throw txError;
  }
}

/**
 * Reconnect wallet using wagmi (for use after page reload)
 */
export async function reconnectWallet(): Promise<void> {
  const account = getAccount(config);
  if (!account.isConnected) {
    // Wallet will auto-reconnect via injected connector if previously connected
    console.log("Wallet not connected, waiting for auto-reconnect...");
  }
}
