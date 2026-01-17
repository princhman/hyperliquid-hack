import { parseUnits } from "viem";
import { getWalletClient, getAccount, switchChain } from "@wagmi/core";
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
  console.log('sendUSDC called with:', { toAddress, amount, requiredChainId });

  // Get account info to check connection and current chain
  const account = getAccount(config);
  
  console.log('Account info:', account);

  if (!account.isConnected || !account.address) {
    throw new Error("Wallet not connected. Please connect your wallet first.");
  }

  const currentChainId = account.chainId;
  console.log('Current chain ID:', currentChainId, 'Required:', requiredChainId);
  
  // Check if we need to switch networks
  if (currentChainId !== requiredChainId) {
    console.log('Switching to chain:', requiredChainId);
    try {
      await switchChain(config, { chainId: requiredChainId as 1 | 42161 | 8453 });
      console.log('Chain switched successfully');
    } catch (switchError) {
      console.error('Failed to switch chain:', switchError);
      throw new Error(`Please switch to the correct network in your wallet (Chain ID: ${requiredChainId})`);
    }
  }

  // Get wallet client for the required chain
  const walletClient = await getWalletClient(config, { chainId: requiredChainId });
  
  console.log('Wallet client:', walletClient);

  if (!walletClient) {
    throw new Error("Failed to get wallet client. Please reconnect your wallet.");
  }

  const usdcAddress = USDC_ADDRESSES[requiredChainId];
  if (!usdcAddress) {
    throw new Error(`USDC not supported on chain ${requiredChainId}`);
  }

  console.log('USDC address for chain:', usdcAddress);

  // Parse amount to proper units (USDC has 6 decimals)
  let amountInUnits;
  try {
    amountInUnits = parseUnits(amount, 6);
    console.log('Amount in units:', amountInUnits.toString());
  } catch (parseError) {
    console.error('Failed to parse amount:', parseError);
    throw new Error(`Invalid amount: ${amount}`);
  }

  console.log('Sending transaction...');

  try {
    const hash = await walletClient.writeContract({
      address: usdcAddress,
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [toAddress, amountInUnits],
    });

    console.log('Transaction sent! Hash:', hash);
    return hash;
  } catch (txError) {
    console.error('Transaction failed:', txError);
    
    // Handle specific transaction errors
    if (txError instanceof Error) {
      if (txError.message.includes('insufficient funds')) {
        throw new Error('Insufficient USDC balance');
      } else if (txError.message.includes('user rejected')) {
        throw new Error('Transaction rejected by user');
      }
    }
    
    throw txError;
  }
}