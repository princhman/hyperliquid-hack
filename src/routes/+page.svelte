<script lang="ts">
    import { Button } from "$lib/components/ui/button";
    import * as Card from "$lib/components/ui/card";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import { goto } from "$app/navigation";
    import pearPoolLogo from "$lib/assets/logo-bg-removebg-preview.png";
    import {
        auth,
        isConnected,
        isAuthenticated,
        walletAddress,
    } from "$lib/stores/auth";
    import { convex, api } from "$lib/convex";
    import * as pear from "$lib/pear/client";

    let isLoading = $state(false);
    let errorMessage = $state<string | null>(null);
    let currentStep = $state<
        "connect" | "authenticate" | "agent-wallet" | "set-username" | "ready"
    >("connect");
    let agentWalletAddress = $state<string | null>(null);
    let accessToken = $state<string | null>(null);
    let username = $state<string | null>(null);
    let newUsername = $state("");

    // Subscribe to auth store for state updates
    auth.subscribe((state: { error: string | null; agentWalletAddress: string | null; isConnected: boolean; isAuthenticated: boolean; agentWalletStatus: string | null; username: string | null }) => {
        errorMessage = state.error;
        agentWalletAddress = state.agentWalletAddress;
        username = state.username;

        // Determine current step based on state
        if (!state.isConnected) {
            currentStep = "connect";
        } else if (!state.isAuthenticated) {
            currentStep = "authenticate";
        } else if (state.agentWalletStatus !== "ACTIVE") {
            currentStep = "agent-wallet";
        } else if (!state.username) {
            currentStep = "set-username";
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

            // Store wallet address in localStorage for other pages
            localStorage.setItem("walletAddress", address);

            // Create user if doesn't exist
            const authResult = await convex.mutation(api.auth.getOrCreateUser, {
                walletAddress: address,
            });
            
            if (authResult.user.username) {
                auth.updateUsername(authResult.user.username);
            }

            // Authenticate with Pear Protocol
            const tokens = await auth.authenticateWithPear(async (tokens: { accessToken: string; refreshToken: string; expiresIn: number }) => {
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

    async function handleSetUsername() {
        if (!newUsername.trim()) return;
        isLoading = true;
        errorMessage = null;

        try {
            const result = await convex.mutation(api.auth.updateUsernameByWallet, {
                walletAddress: $walletAddress!,
                username: newUsername.trim(),
            });
            
            auth.updateUsername(result.username);
        } catch (err) {
            errorMessage = err instanceof Error ? err.message : "Failed to set username";
        } finally {
            isLoading = false;
        }
    }
</script>

<div class="min-h-screen bg-background flex flex-col">
    <header class="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div
            class="container mx-auto px-4 py-4 flex items-center justify-start gap-8"
        >
            <div class="flex items-center">
                <img src={pearPoolLogo} alt="Pear Pool Logo" class="h-12 w-12 mr-1 object-contain" />
                <h1 class="text-xl font-light font-serif leading-none">
                    <a href="/">Pear Pool</a>
                </h1>
            </div>
        </div>
    </header>

    <main
        class="flex-1 container mx-auto px-4 py-12 flex flex-col items-center justify-center gap-12"
    >
        <div class="flex-1 space-y-6 text-center flex flex-col items-center">
            <h2 class="text-4xl lg:text-5xl font-bold tracking-tight">
                Compete. Trade. Win.
            </h2>
            <p class="text-xl text-muted-foreground max-w-lg">
                Join the ultimate trading duel. Start with equal capital, trade
                real markets via Hyperliquid, and climb the leaderboard to win
                the prize pool.
            </p>
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
                    <a
                        href="/lobby"
                        class="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90"
                    >
                        Enter Lobby
                    </a>
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
            {:else if currentStep === "set-username"}
                <!-- Set Username -->
                <Card.Header>
                    <Card.Title>Choose Username</Card.Title>
                    <Card.Description>
                        Set a unique username for the leaderboard
                    </Card.Description>
                </Card.Header>
                <Card.Content class="space-y-4">
                    <form 
                        class="space-y-4"
                        onsubmit={(e) => {
                            e.preventDefault();
                            handleSetUsername();
                        }}
                    >
                        <div class="space-y-2">
                            <Label for="username">Username</Label>
                            <Input
                                id="username"
                                placeholder="e.g. Trader001"
                                bind:value={newUsername}
                                minlength="3"
                                maxlength="20"
                                required
                            />
                            <p class="text-xs text-muted-foreground">
                                3-20 characters, letters, numbers, and underscores only.
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
                            type="submit"
                            class="w-full"
                            disabled={isLoading || !newUsername.trim()}
                        >
                            {isLoading ? "Saving..." : "Set Username"}
                        </Button>
                    </form>
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
        </Card.Root>

    </main>

    <footer class="border-t py-6">
        <div class="container mx-auto px-4 text-center text-muted-foreground">
            <p>Built with Pear Protocol & Hyperliquid</p>
        </div>
    </footer>
</div>
