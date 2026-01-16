/**
 * Hyperliquid API Client
 *
 * Handles agent wallet approval on Hyperliquid
 */

// Hyperliquid API endpoints
const HL_API_MAINNET = "https://api.hyperliquid.xyz";

// EIP-712 domain for Hyperliquid
const HL_EIP712_DOMAIN = {
  name: "HyperliquidSignTransaction",
  version: "1",
  chainId: 42161, // Arbitrum
  verifyingContract: "0x0000000000000000000000000000000000000000" as const,
};

// EIP-712 types for ApproveAgent action
const APPROVE_AGENT_TYPES = {
  "HyperliquidTransaction:ApproveAgent": [
    { name: "hyperliquidChain", type: "string" },
    { name: "agentAddress", type: "address" },
    { name: "agentName", type: "string" },
    { name: "nonce", type: "uint64" },
  ],
} as const;

export interface ApproveAgentParams {
  agentAddress: string;
  agentName?: string;
}

/**
 * Get the EIP-712 typed data for approving an agent wallet
 */
export function getApproveAgentTypedData(params: ApproveAgentParams) {
  const nonce = Date.now();

  return {
    domain: HL_EIP712_DOMAIN,
    types: APPROVE_AGENT_TYPES,
    primaryType: "HyperliquidTransaction:ApproveAgent" as const,
    message: {
      hyperliquidChain: "Mainnet",
      agentAddress: params.agentAddress.toLowerCase() as `0x${string}`,
      agentName: params.agentName || "",
      nonce: BigInt(nonce),
    },
    nonce,
  };
}

/**
 * Submit the agent approval to Hyperliquid
 */
export async function submitAgentApproval(
  userAddress: string,
  agentAddress: string,
  signature: string,
  nonce: number,
  agentName?: string,
): Promise<{ status: string }> {
  const action = {
    type: "approveAgent",
    hyperliquidChain: "Mainnet",
    signatureChainId: "0xa4b1", // Arbitrum chainId in hex
    agentAddress: agentAddress.toLowerCase(),
    agentName: agentName || null,
    nonce,
  };

  const response = await fetch(`${HL_API_MAINNET}/exchange`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action,
      nonce,
      signature: {
        r: signature.slice(0, 66),
        s: "0x" + signature.slice(66, 130),
        v: parseInt(signature.slice(130, 132), 16),
      },
      vaultAddress: null,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to approve agent: ${error}`);
  }

  return response.json();
}
