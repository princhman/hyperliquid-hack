import { writable, derived } from "svelte/store";
import {
  connect,
  disconnect,
  getAccount,
  signTypedData,
  switchChain,
  watchAccount,
} from "@wagmi/core";
import { injected } from "@wagmi/connectors";
import { config } from "$lib/wallet/config";
import * as pear from "$lib/pear/client";

interface AuthState {
  walletAddress: string | null;
  isConnected: boolean;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  error: string | null;
  agentWalletStatus: "ACTIVE" | "EXPIRED" | "NOT_FOUND" | null;
  agentWalletAddress: string | null;
}

const initialState: AuthState = {
  walletAddress: null,
  isConnected: false,
  isAuthenticating: false,
  isAuthenticated: false,
  error: null,
  agentWalletStatus: null,
  agentWalletAddress: null,
};

function createAuthStore() {
  const { subscribe, set, update } = writable<AuthState>(initialState);

  // Watch for account changes
  if (typeof window !== "undefined") {
    watchAccount(config, {
      onChange(account) {
        update((state) => ({
          ...state,
          walletAddress: account.address?.toLowerCase() ?? null,
          isConnected: account.isConnected,
          // Reset auth state if wallet disconnects or changes
          isAuthenticated: account.isConnected ? state.isAuthenticated : false,
        }));
      },
    });

    // Check initial account state
    const account = getAccount(config);
    if (account.isConnected && account.address) {
      update((state) => ({
        ...state,
        walletAddress: account.address!.toLowerCase(),
        isConnected: true,
      }));
    }
  }

  return {
    subscribe,

    /**
     * Connect wallet (MetaMask or other injected wallet)
     */
    async connectWallet() {
      update((state) => ({ ...state, error: null }));

      try {
        const result = await connect(config, { connector: injected() });
        update((state) => ({
          ...state,
          walletAddress: result.accounts[0].toLowerCase(),
          isConnected: true,
        }));
        return result.accounts[0];
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to connect wallet";
        update((state) => ({ ...state, error: message }));
        throw err;
      }
    },

    /**
     * Disconnect wallet
     */
    async disconnectWallet() {
      try {
        await disconnect(config);
        set(initialState);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to disconnect";
        update((state) => ({ ...state, error: message }));
      }
    },

    /**
     * Authenticate with Pear Protocol
     * Returns tokens that should be stored in Convex
     */
    async authenticateWithPear(
      onStoreTokens: (tokens: {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      }) => Promise<void>,
    ) {
      update((state) => ({ ...state, isAuthenticating: true, error: null }));

      try {
        const account = getAccount(config);
        if (!account.address) {
          throw new Error("Wallet not connected");
        }

        const walletAddress = account.address;

        // Step 1: Get EIP-712 message
        const eip712Message = await pear.getEIP712Message(walletAddress);

        // Step 2: Switch to the required chain if needed
        const requiredChainId = eip712Message.domain.chainId as 1 | 42161;
        if (requiredChainId && account.chainId !== requiredChainId) {
          await switchChain(config, { chainId: requiredChainId });
        }

        // Step 3: Sign the message
        const signature = await signTypedData(config, {
          domain: eip712Message.domain as {
            name: string;
            version: string;
            chainId: number;
          },
          types: eip712Message.types,
          primaryType: eip712Message.primaryType,
          message: eip712Message.message,
        });

        // Step 4: Authenticate with Pear (include timestamp from EIP-712 message)
        const tokens = await pear.authenticate(
          walletAddress,
          signature,
          eip712Message.timestamp,
        );

        // Step 5: Store tokens (callback to Convex)
        await onStoreTokens(tokens);

        update((state) => ({
          ...state,
          isAuthenticating: false,
          isAuthenticated: true,
        }));

        return tokens;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Authentication failed";
        update((state) => ({
          ...state,
          isAuthenticating: false,
          error: message,
        }));
        throw err;
      }
    },

    /**
     * Check and setup agent wallet
     */
    async setupAgentWallet(
      accessToken: string,
      onStoreAgentWallet: (wallet: {
        address: string;
        status: "ACTIVE" | "EXPIRED" | "NOT_FOUND";
      }) => Promise<void>,
    ) {
      try {
        // Check current agent wallet status
        const agentWallet = await pear.getAgentWallet(accessToken);

        if (agentWallet.status === "ACTIVE") {
          await onStoreAgentWallet(agentWallet);
          update((state) => ({
            ...state,
            agentWalletStatus: agentWallet.status,
            agentWalletAddress: agentWallet.address,
          }));
          return agentWallet;
        }

        // Need to create new agent wallet
        const newWallet = await pear.createAgentWallet(accessToken);

        // User needs to approve this wallet on Hyperliquid
        // Return the address so the UI can prompt for approval
        const walletInfo = {
          address: newWallet.address,
          status: "NOT_FOUND" as const, // Will be ACTIVE after user approves
        };

        update((state) => ({
          ...state,
          agentWalletStatus: "NOT_FOUND",
          agentWalletAddress: newWallet.address,
        }));

        return walletInfo;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to setup agent wallet";
        update((state) => ({ ...state, error: message }));
        throw err;
      }
    },

    /**
     * Update agent wallet status after user approval
     */
    updateAgentWalletStatus(status: "ACTIVE" | "EXPIRED" | "NOT_FOUND") {
      update((state) => ({
        ...state,
        agentWalletStatus: status,
      }));
    },

    /**
     * Set authenticated state (e.g., after checking stored tokens)
     */
    setAuthenticated(isAuthenticated: boolean) {
      update((state) => ({ ...state, isAuthenticated }));
    },

    /**
     * Clear error
     */
    clearError() {
      update((state) => ({ ...state, error: null }));
    },

    /**
     * Reset store
     */
    reset() {
      set(initialState);
    },
  };
}

export const auth = createAuthStore();

// Derived stores for convenience
export const isConnected = derived(auth, ($auth) => $auth.isConnected);
export const isAuthenticated = derived(auth, ($auth) => $auth.isAuthenticated);
export const walletAddress = derived(auth, ($auth) => $auth.walletAddress);
