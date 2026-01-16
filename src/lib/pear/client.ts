/**
 * Pear Protocol API Client
 *
 * Handles authentication flow with Pear Protocol using EIP-712 signatures
 */

const PEAR_API_BASE = "https://hl-v2.pearprotocol.io";
const CLIENT_ID = "HLHackathon4";

export interface EIP712Message {
  domain: {
    name: string;
    version: string;
    chainId: number;
  };
  types: {
    [key: string]: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  message: Record<string, unknown>;
  timestamp: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  address: string;
  clientId: string;
}

export interface AgentWalletResponse {
  agentWalletAddress: string;
}

export interface AgentWallet {
  address: string;
  status: "ACTIVE" | "EXPIRED" | "NOT_FOUND";
}

/**
 * Get the EIP-712 message that the user needs to sign
 */
export async function getEIP712Message(
  walletAddress: string,
): Promise<EIP712Message> {
  const params = new URLSearchParams({
    address: walletAddress,
    clientId: CLIENT_ID,
  });

  const response = await fetch(
    `${PEAR_API_BASE}/auth/eip712-message?${params}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get EIP-712 message: ${error}`);
  }

  return response.json();
}

/**
 * Authenticate with Pear Protocol using the signed message
 */
export async function authenticate(
  walletAddress: string,
  signature: string,
  timestamp: number,
): Promise<AuthTokens> {
  const response = await fetch(`${PEAR_API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      method: "eip712",
      address: walletAddress,
      clientId: CLIENT_ID,
      details: {
        signature,
        timestamp,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Authentication failed: ${error}`);
  }

  return response.json();
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${PEAR_API_BASE}/auth/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

/**
 * Logout and invalidate the refresh token
 */
export async function logout(refreshToken: string): Promise<void> {
  const response = await fetch(`${PEAR_API_BASE}/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Logout failed: ${error}`);
  }
}

/**
 * Get the agent wallet status for a user
 */
export async function getAgentWallet(
  accessToken: string,
): Promise<AgentWallet> {
  const response = await fetch(`${PEAR_API_BASE}/agentWallet`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return { address: "", status: "NOT_FOUND" };
    }
    const error = await response.text();
    throw new Error(`Failed to get agent wallet: ${error}`);
  }

  const data: AgentWalletResponse = await response.json();
  return {
    address: data.agentWalletAddress,
    status: "ACTIVE",
  };
}

/**
 * Create a new agent wallet
 */
export async function createAgentWallet(
  accessToken: string,
): Promise<{ address: string; message: string }> {
  const response = await fetch(`${PEAR_API_BASE}/agentWallet`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create agent wallet: ${error}`);
  }

  const data = await response.json();
  return {
    address: data.agentWalletAddress,
    message: data.message,
  };
}
