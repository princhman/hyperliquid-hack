<script lang="ts">
    import {
        auth,
        isConnected,
        isAuthenticated,
        walletAddress,
    } from "$lib/stores/auth";
    import { convex } from "$lib/convex";
    import { api } from "../convex/_generated/api";

    let isLoading = $state(false);
    let errorMessage = $state<string | null>(null);

    // Subscribe to auth store for error updates
    auth.subscribe((state) => {
        errorMessage = state.error;
    });

    async function handleConnectWallet() {
        isLoading = true;
        errorMessage = null;
        try {
            await auth.connectWallet();
        } catch (err) {
            // Error is handled in the store
        } finally {
            isLoading = false;
        }
    }

    async function handleLogin() {
        isLoading = true;
        errorMessage = null;

        try {
            const address = $walletAddress;
            if (!address) {
                throw new Error("Wallet not connected");
            }

            // Create user if doesn't exist
            await convex.mutation(api.auth.getOrCreateUser, {
                walletAddress: address,
            });

            // Authenticate with Pear Protocol
            await auth.authenticateWithPear(async (tokens) => {
                // Store tokens in Convex
                await convex.mutation(api.auth.storePearTokens, {
                    walletAddress: address,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresIn: tokens.expiresIn,
                });
            });
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : "Login failed";
        } finally {
            isLoading = false;
        }
    }

    async function handleDisconnect() {
        await auth.disconnectWallet();
    }

    function shortenAddress(address: string): string {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
</script>

<div
    class="min-h-screen bg-gray-900 flex flex-col items-center justify-center p-4"
>
    <div class="max-w-md w-full space-y-8">
        <!-- Header -->
        <div class="text-center">
            <h1 class="text-4xl font-bold text-white mb-2">Hyperliquid Hack</h1>
            <p class="text-gray-400">Competitive pair-trading game</p>
        </div>

        <!-- Auth Card -->
        <div class="bg-gray-800 rounded-xl p-8 shadow-xl">
            {#if $isAuthenticated}
                <!-- Authenticated State -->
                <div class="text-center space-y-4">
                    <div
                        class="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto"
                    >
                        <svg
                            class="w-8 h-8 text-green-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                    </div>
                    <h2 class="text-xl font-semibold text-white">
                        Connected & Authenticated
                    </h2>
                    <p class="text-gray-400 font-mono text-sm">
                        {$walletAddress ? shortenAddress($walletAddress) : ""}
                    </p>
                    <button
                        onclick={handleDisconnect}
                        class="w-full py-3 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                    >
                        Disconnect
                    </button>
                </div>
            {:else if $isConnected}
                <!-- Connected but not authenticated -->
                <div class="space-y-4">
                    <div class="text-center">
                        <p class="text-gray-400 mb-2">Wallet Connected</p>
                        <p class="text-white font-mono text-sm">
                            {$walletAddress
                                ? shortenAddress($walletAddress)
                                : ""}
                        </p>
                    </div>

                    {#if errorMessage}
                        <div
                            class="bg-red-500/10 border border-red-500/20 rounded-lg p-3"
                        >
                            <p class="text-red-400 text-sm">{errorMessage}</p>
                        </div>
                    {/if}

                    <button
                        onclick={handleLogin}
                        disabled={isLoading}
                        class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        {#if isLoading}
                            <svg
                                class="animate-spin h-5 w-5"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    class="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    stroke-width="4"
                                    fill="none"
                                />
                                <path
                                    class="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                            </svg>
                            Signing...
                        {:else}
                            Sign in with Pear Protocol
                        {/if}
                    </button>

                    <button
                        onclick={handleDisconnect}
                        class="w-full py-2 px-4 text-gray-400 hover:text-white transition-colors text-sm"
                    >
                        Disconnect Wallet
                    </button>
                </div>
            {:else}
                <!-- Not connected -->
                <div class="space-y-4">
                    <div class="text-center">
                        <h2 class="text-xl font-semibold text-white mb-2">
                            Connect Your Wallet
                        </h2>
                        <p class="text-gray-400 text-sm">
                            Connect your wallet to start trading
                        </p>
                    </div>

                    {#if errorMessage}
                        <div
                            class="bg-red-500/10 border border-red-500/20 rounded-lg p-3"
                        >
                            <p class="text-red-400 text-sm">{errorMessage}</p>
                        </div>
                    {/if}

                    <button
                        onclick={handleConnectWallet}
                        disabled={isLoading}
                        class="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        {#if isLoading}
                            <svg
                                class="animate-spin h-5 w-5"
                                viewBox="0 0 24 24"
                            >
                                <circle
                                    class="opacity-25"
                                    cx="12"
                                    cy="12"
                                    r="10"
                                    stroke="currentColor"
                                    stroke-width="4"
                                    fill="none"
                                />
                                <path
                                    class="opacity-75"
                                    fill="currentColor"
                                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                />
                            </svg>
                            Connecting...
                        {:else}
                            <svg
                                class="w-5 h-5"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                            >
                                <path
                                    d="M21 18v1c0 1.1-.9 2-2 2H5c-1.11 0-2-.9-2-2V5c0-1.1.89-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.11 0-2 .9-2 2v8c0 1.1.89 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"
                                />
                            </svg>
                            Connect Wallet
                        {/if}
                    </button>
                </div>
            {/if}
        </div>

        <!-- Info -->
        <p class="text-center text-gray-500 text-xs">
            By connecting, you agree to sign a message to verify wallet
            ownership.
            <br />No transaction fees required.
        </p>
    </div>
</div>
