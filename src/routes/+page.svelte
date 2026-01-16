<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import * as Card from "$lib/components/ui/card";
    import { goto } from "$app/navigation";
    import {
        auth,
        isConnected,
        isAuthenticated,
        walletAddress,
    } from "$lib/stores/auth";
    import { convex } from "$lib/convex";
    import { api } from "../convex/_generated/api";
    import * as pear from "$lib/pear/client";

    let isLoading = $state(false);
    let errorMessage = $state<string | null>(null);
    let currentStep = $state<
        "connect" | "authenticate" | "agent-wallet" | "ready"
    >("connect");
    let agentWalletAddress = $state<string | null>(null);
    let accessToken = $state<string | null>(null);

    // Subscribe to auth store for state updates
    auth.subscribe((state) => {
        errorMessage = state.error;
        agentWalletAddress = state.agentWalletAddress;

        // Determine current step based on state
        if (!state.isConnected) {
            currentStep = "connect";
        } else if (!state.isAuthenticated) {
            currentStep = "authenticate";
        } else if (state.agentWalletStatus !== "ACTIVE") {
            currentStep = "agent-wallet";
        } else {
            currentStep = "ready";
        }
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
            const tokens = await auth.authenticateWithPear(async (tokens) => {
                // Store tokens in Convex
                await convex.mutation(api.auth.storePearTokens, {
                    walletAddress: address,
                    accessToken: tokens.accessToken,
                    refreshToken: tokens.refreshToken,
                    expiresIn: tokens.expiresIn,
                });
            });

            // Store access token for agent wallet setup
            accessToken = tokens.accessToken;

            // Check agent wallet status
            await checkAgentWallet(tokens.accessToken);
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : "Login failed";
        } finally {
            isLoading = false;
        }
    }

    async function checkAgentWallet(token: string) {
        try {
            const wallet = await pear.getAgentWallet(token);

            if (wallet.status === "ACTIVE") {
                // Already have an active wallet
                auth.updateAgentWalletStatus("ACTIVE");
                await convex.mutation(api.auth.storeAgentWallet, {
                    walletAddress: $walletAddress!,
                    agentWalletAddress: wallet.address,
                    status: "ACTIVE",
                });
            } else {
                // Need to create and approve
                const newWallet = await pear.createAgentWallet(token);
                agentWalletAddress = newWallet.address;
                auth.updateAgentWalletStatus("NOT_FOUND");
            }
        } catch (err) {
            // If 404, need to create wallet
            if (err instanceof Error && err.message.includes("404")) {
                const newWallet = await pear.createAgentWallet(token);
                agentWalletAddress = newWallet.address;
                auth.updateAgentWalletStatus("NOT_FOUND");
            } else {
                throw err;
            }
        }
    }

    async function handleApproveAgentWallet() {
        isLoading = true;
        errorMessage = null;

        try {
            if (!agentWalletAddress) {
                throw new Error("No agent wallet address");
            }

            await auth.approveAgentWallet(agentWalletAddress, async () => {
                // Store in Convex after approval
                await convex.mutation(api.auth.storeAgentWallet, {
                    walletAddress: $walletAddress!,
                    agentWalletAddress: agentWalletAddress!,
                    status: "ACTIVE",
                });
            });

            // Navigate to lobby after successful approval
            await goto("/lobby");
        } catch (err) {
            errorMessage =
                err instanceof Error ? err.message : "Approval failed";
        } finally {
            isLoading = false;
        }
    }

    async function handleDisconnect() {
        await auth.disconnectWallet();
        accessToken = null;
        agentWalletAddress = null;
    }

    function shortenAddress(address: string): string {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    function goToLobby() {
        goto("/lobby");
    }
</script>

<div class="min-h-screen bg-background flex flex-col">
    <header class="border-b">
        <div
            class="container mx-auto px-4 py-4 flex items-center justify-between"
        >
            <h1 class="text-2xl font-bold">
                <a href="/">Pear Pool</a>
            </h1>
            <nav class="flex gap-4">
                <Button variant="ghost" href="/how-it-works"
                    >How it Works</Button
                >
            </nav>
        </div>
    </header>

    <main
        class="flex-1 container mx-auto px-4 py-12 flex flex-col lg:flex-row items-center gap-12"
    >
        <div class="flex-1 space-y-6">
            <h2 class="text-4xl lg:text-5xl font-bold tracking-tight">
                Compete. Trade. Win.
            </h2>
            <p class="text-xl text-muted-foreground max-w-lg">
                Join the ultimate trading duel. Start with equal capital, trade
                real markets via Hyperliquid, and climb the leaderboard to win
                the prize pool.
            </p>
            <div class="flex justify-start">
                <Button size="lg" variant="outline" href="/learn-more"
                    >Learn More</Button
                >
            </div>
        </div>

        <Card.Root class="w-full max-w-sm">
            {#if currentStep === "ready"}
                <!-- Ready to trade -->
                <Card.Header>
                    <Card.Title>Ready to Trade!</Card.Title>
                    <Card.Description>
                        Your wallet is connected and approved
                    </Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4">
                    <div class="text-center space-y-2">
                        <p class="text-muted-foreground font-mono text-sm">
                            {$walletAddress
                                ? shortenAddress($walletAddress)
                                : ""}
                        </p>
                        <p class="text-muted-foreground text-xs">
                            Agent Wallet: {agentWalletAddress
                                ? shortenAddress(agentWalletAddress)
                                : "Active"}
                        </p>
                    </div>
                    <Button class="w-full" onclick={goToLobby}>
                        Enter Lobby
                    </Button>
                    <Button
                        variant="outline"
                        class="w-full"
                        onclick={handleDisconnect}
                    >
                        Disconnect
                    </Button>
                </Card.Content>
            {:else if currentStep === "agent-wallet"}
                <!-- Need to approve agent wallet -->
                <Card.Header>
                    <Card.Title>Approve Agent Wallet</Card.Title>
                    <Card.Description>
                        Pear Protocol needs permission to trade on your behalf
                        via Hyperliquid
                    </Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4">
                    {#if agentWalletAddress}
                        <div
                            class="p-2 bg-muted rounded text-xs font-mono text-center break-all"
                        >
                            {agentWalletAddress}
                        </div>
                    {/if}

                    {#if errorMessage}
                        <div
                            class="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md"
                        >
                            {errorMessage}
                        </div>
                    {/if}

                    <Button
                        class="w-full"
                        onclick={handleApproveAgentWallet}
                        disabled={isLoading}
                    >
                        {isLoading ? "Approving..." : "Approve on Hyperliquid"}
                    </Button>
                    <Button
                        variant="ghost"
                        class="w-full"
                        onclick={handleDisconnect}
                    >
                        Disconnect Wallet
                    </Button>
                </Card.Content>
            {:else if currentStep === "authenticate"}
                <!-- Connected but not authenticated -->
                <Card.Header>
                    <Card.Title>Sign In</Card.Title>
                    <Card.Description>
                        Sign a message to authenticate with Pear Protocol
                    </Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4">
                    <div class="text-center">
                        <p class="text-muted-foreground mb-2">
                            Wallet Connected
                        </p>
                        <p class="font-mono text-sm">
                            {$walletAddress
                                ? shortenAddress($walletAddress)
                                : ""}
                        </p>
                    </div>

                    {#if errorMessage}
                        <div
                            class="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md"
                        >
                            {errorMessage}
                        </div>
                    {/if}

                    <Button
                        class="w-full"
                        onclick={handleLogin}
                        disabled={isLoading}
                    >
                        {isLoading
                            ? "Signing..."
                            : "Sign in with Pear Protocol"}
                    </Button>
                    <Button
                        variant="ghost"
                        class="w-full"
                        onclick={handleDisconnect}
                    >
                        Disconnect Wallet
                    </Button>
                </Card.Content>
            {:else}
                <!-- Not connected -->
                <Card.Header>
                    <Card.Title>Connect Your Wallet</Card.Title>
                    <Card.Description>
                        Connect your wallet to start trading
                    </Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4">
                    {#if errorMessage}
                        <div
                            class="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md"
                        >
                            {errorMessage}
                        </div>
                    {/if}

                    <Button
                        class="w-full"
                        onclick={handleConnectWallet}
                        disabled={isLoading}
                    >
                        {isLoading ? "Connecting..." : "Connect Wallet"}
                    </Button>
                </Card.Content>
            {/if}

            <!-- Progress indicator -->
            <Card.Footer class="flex justify-center gap-2">
                {#each ["connect", "authenticate", "agent-wallet", "ready"] as step, i}
                    <div
                        class="w-2 h-2 rounded-full {currentStep === step
                            ? 'bg-primary'
                            : [
                                    'connect',
                                    'authenticate',
                                    'agent-wallet',
                                    'ready',
                                ].indexOf(currentStep) > i
                              ? 'bg-primary/60'
                              : 'bg-muted'}"
                    ></div>
                {/each}
            </Card.Footer>
        </Card.Root>
    </main>

    <footer class="border-t py-6">
        <div class="container mx-auto px-4 text-center text-muted-foreground">
            <p>Built with Pear Protocol & Hyperliquid</p>
        </div>
    </footer>
</div>
