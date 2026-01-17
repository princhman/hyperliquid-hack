<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Card from "$lib/components/ui/card";
    import { convex, api } from "$lib/convex";
    import { auth } from "$lib/stores/auth";
    import type { Id } from "../convex/_generated/dataModel";
    import type { FunctionReturnType } from "convex/server";
    import { LogOut, Plus, ArrowLeft, Trophy } from "@lucide/svelte";
    import { sendBuyIn } from "$lib/usdc";
    import { reconnect } from "@wagmi/core";
    import { config } from "$lib/wagmi";

    type Lobby = FunctionReturnType<typeof api.lobby.getLobbies>[number];
    type LeaderboardEntry = FunctionReturnType<
        typeof api.lobby.getLeaderboard
    >[number];
    type AssetPosition = {
        coin: string;
        entryPrice: number;
        actualSize: number;
        leverage: number;
        marginUsed: number;
        positionValue: number;
        unrealizedPnl: number;
    };

    type Position = {
        positionId: string;
        positionValue: number;
        marginUsed: number;
        unrealizedPnl: number;
        unrealizedPnlPercentage: number;
        longAssets: AssetPosition[];
        shortAssets: AssetPosition[];
    };

    let walletAddress = $state("");
    let username = $state("");
    let step = $state<"connect" | "register" | "logged-in">("connect");
    let error = $state("");
    let loading = $state(false);
    let currentUser = $state<{
        id: string;
        walletAddress: string;
        username?: string;
    } | null>(null);

    // Lobby state
    let lobbies = $state<Lobby[]>([]);
    let loadingLobbies = $state(false);
    let showCreateLobby = $state(false);
    let joiningLobbyId = $state<string | null>(null);

    // Create lobby form
    let newLobbyName = $state("");
    let newLobbyBuyIn = $state(10000);
    let newLobbyStartTime = $state("");
    let newLobbyDuration = $state(30); // minutes
    let newLobbyIsDemo = $state(true); // Default to demo mode
    let creatingLobby = $state(false);

    // Active lobby state
    let activeLobby = $state<Lobby | null>(null);
    let leaderboard = $state<LeaderboardEntry[]>([]);
    let positions = $state<Position[]>([]);
    let userCashBalance = $state(0);
    let userPositionsValue = $state(0);
    let userBalance = $state(0);
    let syncActive = $state(false);
    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    // Buy form (pair trading: long one asset, short another)
    let buyLongAsset = $state("BTC");
    let buyShortAsset = $state("ETH");
    let buyLeverage = $state(1);
    let buyUsdValue = $state(100);
    let buySlippage = $state(0.01);
    let buyExecutionType = $state<"MARKET" | "SYNC" | "TWAP">("MARKET");
    let buyingPosition = $state(false);
    let closingPositionId = $state<string | null>(null);

    // Helper to get default start time (5 min from now, rounded to nearest 5 min)
    function getDefaultStartTime() {
        const now = new Date();
        now.setMinutes(now.getMinutes() + 5);
        now.setMinutes(Math.ceil(now.getMinutes() / 5) * 5);
        now.setSeconds(0);
        now.setMilliseconds(0);
        return now.toISOString().slice(0, 16); // Format: YYYY-MM-DDTHH:mm
    }

    onMount(async () => {
        // Reconnect wagmi on page load
        await reconnect(config);

        const storedWallet = auth.setFromStorage();
        if (storedWallet) {
            await checkExistingUser(storedWallet);
        }
    });

    onDestroy(() => {
        if (refreshInterval) clearInterval(refreshInterval);
    });

    async function checkExistingUser(address: string) {
        loading = true;
        error = "";
        try {
            const user = await convex.query(api.auth.getUserByWallet, {
                walletAddress: address,
            });

            if (user) {
                currentUser = {
                    id: user._id,
                    walletAddress: user.walletAddress,
                    username: user.username,
                };
                auth.login(currentUser);
                auth.persistWallet(address);
                step = "logged-in";
                await loadLobbies();
            } else {
                walletAddress = address;
                step = "register";
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to check user";
        } finally {
            loading = false;
        }
    }

    async function loadLobbies() {
        loadingLobbies = true;
        try {
            lobbies = await convex.query(api.lobby.getLobbies, {
                userId: currentUser?.id as Id<"users"> | undefined,
            });
        } catch (e) {
            console.error("Failed to load lobbies:", e);
        } finally {
            loadingLobbies = false;
        }
    }

    async function connectWallet() {
        if (typeof window.ethereum === "undefined") {
            error = "MetaMask is not installed";
            return;
        }

        loading = true;
        error = "";

        try {
            const accounts = (await window.ethereum.request({
                method: "eth_requestAccounts",
            })) as string[];

            if (accounts && accounts.length > 0) {
                const address = accounts[0];
                await checkExistingUser(address);
            }
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to connect wallet";
        } finally {
            loading = false;
        }
    }

    async function register() {
        if (!username.trim()) {
            error = "Username is required";
            return;
        }

        loading = true;
        error = "";

        try {
            const result = await convex.mutation(api.auth.createUser, {
                walletAddress,
                username: username.trim(),
            });

            currentUser = {
                id: result.id,
                walletAddress: result.walletAddress,
                username: result.username,
            };
            auth.login(currentUser);
            auth.persistWallet(walletAddress);
            step = "logged-in";
            await loadLobbies();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to create account";
        } finally {
            loading = false;
        }
    }

    async function createLobby() {
        if (!newLobbyName.trim() || !currentUser) {
            error = "Lobby name is required";
            return;
        }

        if (!newLobbyStartTime) {
            error = "Start time is required";
            return;
        }

        creatingLobby = true;
        error = "";

        try {
            const startTime = new Date(newLobbyStartTime).getTime();
            const endTime = startTime + newLobbyDuration * 60 * 1000;

            if (startTime < Date.now()) {
                error = "Start time must be in the future";
                creatingLobby = false;
                return;
            }

            await convex.mutation(api.lobby.createLobby, {
                name: newLobbyName.trim(),
                createdBy: currentUser.id as Id<"users">,
                startTime,
                endTime,
                buyIn: newLobbyBuyIn,
                isDemo: newLobbyIsDemo,
            });

            newLobbyName = "";
            newLobbyBuyIn = 10000;
            newLobbyStartTime = "";
            newLobbyDuration = 30;
            newLobbyIsDemo = true;
            showCreateLobby = false;
            await loadLobbies();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to create lobby";
        } finally {
            creatingLobby = false;
        }
    }

    async function joinLobby(lobby: Lobby) {
        if (!currentUser) return;

        joiningLobbyId = lobby._id;
        error = "";

        try {
            // Check if this is a demo lobby
            if (lobby.isDemo) {
                // Demo lobby - no payment required
                await convex.mutation(api.lobby.joinDemoLobby, {
                    userId: currentUser.id as Id<"users">,
                    lobbyId: lobby._id,
                    walletAddress: currentUser.walletAddress,
                });
            } else {
                // Real lobby - requires USDC payment
                const payment = await sendBuyIn(lobby.buyIn);
                await convex.mutation(api.lobby.joinLobby, {
                    userId: currentUser.id as Id<"users">,
                    lobbyId: lobby._id,
                    walletAddress: currentUser.walletAddress,
                    transactionId: payment.hash,
                });
            }

            await loadLobbies();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to join lobby";
        } finally {
            joiningLobbyId = null;
        }
    }

    function logout() {
        auth.logout();
        currentUser = null;
        walletAddress = "";
        username = "";
        lobbies = [];
        step = "connect";
    }

    function shortenAddress(address: string) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }

    function formatDate(timestamp: number) {
        return new Date(timestamp).toLocaleString();
    }

    function getStatusColor(status: string) {
        switch (status) {
            case "not started":
                return "text-yellow-600 dark:text-yellow-400";
            case "started":
                return "text-green-600 dark:text-green-400";
            case "finished":
                return "text-muted-foreground";
            default:
                return "";
        }
    }

    // Derive status on frontend to avoid timezone issues
    function deriveStatus(
        startTime: number,
        endTime: number,
    ): "not started" | "started" | "finished" {
        const now = Date.now();
        if (now < startTime) return "not started";
        if (now >= endTime) return "finished";
        return "started";
    }

    async function enterLobby(lobby: Lobby) {
        activeLobby = lobby;
        await refreshActiveLobby();

        // Start refresh interval
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(refreshActiveLobby, 3000);

        // Start sync if lobby is started
        if (lobby.status === "started" && currentUser) {
            await startSync();
        }
    }

    async function refreshActiveLobby() {
        if (!activeLobby || !currentUser) return;

        // Derive current status from timestamps (frontend)
        const currentStatus = deriveStatus(
            activeLobby.startTime,
            activeLobby.endTime,
        );
        activeLobby = { ...activeLobby, status: currentStatus };

        // Check if game ended
        if (currentStatus === "finished" && positions.length > 0) {
            await endGame();
            return;
        }

        // Start sync if just started
        if (currentStatus === "started" && !syncActive) {
            await startSync();
        }

        // Load leaderboard
        leaderboard = await convex.query(api.lobby.getLeaderboard, {
            lobbyId: activeLobby._id,
        });

        // Get user balance
        const userEntry = leaderboard.find(
            (e) => e.username === currentUser?.username,
        );
        userBalance = userEntry?.totalValue ?? activeLobby.buyIn;
        userCashBalance = userEntry?.balance ?? activeLobby.buyIn;
        userPositionsValue = userEntry?.valueInPositions ?? 0;

        // Load positions
        try {
            const params = new URLSearchParams({
                lobbyId: activeLobby._id,
                address: currentUser.walletAddress,
            });
            const res = await fetch(`/api/positions?${params}`, {
                headers: {
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
            });
            if (res.ok) {
                const data = await res.json();
                positions = Array.isArray(data) ? data : [];
            }
        } catch (e) {
            console.error("Failed to load positions:", e);
        }
    }

    async function startSync() {
        if (!currentUser || syncActive) return;
        try {
            await fetch("/api/positions/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address: currentUser.walletAddress,
                    lobbyId: activeLobby?._id,
                }),
            });
            syncActive = true;
        } catch (e) {
            console.error("Failed to start sync:", e);
        }
    }

    async function buyPosition() {
        if (!currentUser || !activeLobby || buyingPosition) return;

        // Validate balance
        if (buyUsdValue > userBalance) {
            error = "Insufficient balance";
            return;
        }

        buyingPosition = true;
        error = "";

        try {
            const res = await fetch("/api/positions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                    address: currentUser.walletAddress,
                    slippage: buySlippage,
                    executionType: buyExecutionType,
                    leverage: buyLeverage,
                    usdValue: buyUsdValue,
                    longAsset: buyLongAsset,
                    shortAsset: buyShortAsset,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to open position");
            }

            await refreshActiveLobby();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to open position";
        } finally {
            buyingPosition = false;
        }
    }

    async function closePosition(positionId: string) {
        if (!currentUser || !activeLobby || closingPositionId) return;

        closingPositionId = positionId;
        error = "";

        try {
            const res = await fetch("/api/positions/close", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    positionId,
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to close position");
            }

            await refreshActiveLobby();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to close position";
        } finally {
            closingPositionId = null;
        }
    }

    async function endGame() {
        if (!activeLobby || !currentUser) return;

        // Close all positions
        try {
            await fetch("/api/positions/close-all", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    address: currentUser.walletAddress,
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                }),
            });
        } catch (e) {
            console.error("Failed to close all positions:", e);
        }

        // Status is derived from time, just refresh to show final state
        activeLobby = { ...activeLobby, status: "finished" };
        await refreshActiveLobby();

        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }

    function leaveLobby() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        activeLobby = null;
        leaderboard = [];
        positions = [];
        loadLobbies();
    }
</script>

<div class="min-h-screen bg-background p-4">
    {#if step === "connect" || step === "register"}
        <div class="flex min-h-screen items-center justify-center">
            <Card.Root class="w-full max-w-md">
                <Card.Header>
                    <Card.Title class="text-center text-2xl">
                        {#if step === "connect"}
                            Connect Wallet
                        {:else}
                            Create Account
                        {/if}
                    </Card.Title>
                    <Card.Description class="text-center">
                        {#if step === "connect"}
                            Connect your MetaMask wallet to continue
                        {:else}
                            Choose a username for your account
                        {/if}
                    </Card.Description>
                </Card.Header>

                <Card.Content class="space-y-4">
                    {#if error}
                        <div
                            class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                        >
                            {error}
                        </div>
                    {/if}

                    {#if step === "connect"}
                        <Button
                            onclick={connectWallet}
                            disabled={loading}
                            class="w-full"
                            size="lg"
                        >
                            {#if loading}
                                Connecting...
                            {:else}
                                Connect MetaMask
                            {/if}
                        </Button>
                    {:else if step === "register"}
                        <div class="space-y-2">
                            <Label>Wallet Address</Label>
                            <div
                                class="rounded-md border bg-muted/50 p-3 text-sm font-mono"
                            >
                                {shortenAddress(walletAddress)}
                            </div>
                        </div>

                        <div class="space-y-2">
                            <Label for="username">Username</Label>
                            <Input
                                id="username"
                                bind:value={username}
                                placeholder="Enter your username"
                                disabled={loading}
                                onkeydown={(e) =>
                                    e.key === "Enter" && register()}
                            />
                        </div>

                        <Button
                            onclick={register}
                            disabled={loading || !username.trim()}
                            class="w-full"
                            size="lg"
                        >
                            {#if loading}
                                Creating...
                            {:else}
                                Create Account
                            {/if}
                        </Button>
                    {/if}
                </Card.Content>
            </Card.Root>
        </div>
    {:else if step === "logged-in" && currentUser && activeLobby}
        <!-- Active Lobby View -->
        <div class="mx-auto max-w-4xl space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <Button onclick={leaveLobby} variant="ghost" size="icon">
                        <ArrowLeft class="size-4" />
                    </Button>
                    <div>
                        <div class="flex items-center gap-2">
                            <h1 class="text-2xl font-bold">
                                {activeLobby.name}
                            </h1>
                            {#if activeLobby.isDemo}
                                <span
                                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                >
                                    DEMO
                                </span>
                            {/if}
                        </div>
                        <p class="text-sm text-muted-foreground">
                            Total: <span class="font-mono font-bold"
                                >${userBalance.toFixed(2)}</span
                            >
                            <span class="mx-1">|</span>
                            Cash:
                            <span class="font-mono"
                                >${userCashBalance.toFixed(2)}</span
                            >
                            <span class="mx-1">|</span>
                            In Trades:
                            <span class="font-mono"
                                >${userPositionsValue.toFixed(2)}</span
                            >
                            {#if activeLobby.isDemo}
                                <span class="text-purple-600 ml-1">(Paper)</span
                                >
                            {/if}
                            <span class={getStatusColor(activeLobby.status)}>
                                - {activeLobby.status}</span
                            >
                        </p>
                    </div>
                </div>
            </div>

            {#if error}
                <div
                    class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </div>
            {/if}

            <!-- Buy Form (only if started) -->
            {#if activeLobby.status === "started"}
                <Card.Root>
                    <Card.Header>
                        <Card.Title>Open Pair Trade</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-4">
                        <div class="grid grid-cols-4 gap-4">
                            <div class="space-y-2">
                                <Label>Long</Label>
                                <Input
                                    bind:value={buyLongAsset}
                                    placeholder="BTC"
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Short</Label>
                                <Input
                                    bind:value={buyShortAsset}
                                    placeholder="ETH"
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>USD</Label>
                                <Input
                                    type="number"
                                    bind:value={buyUsdValue}
                                    min={1}
                                    max={userBalance}
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Leverage</Label>
                                <Input
                                    type="number"
                                    bind:value={buyLeverage}
                                    min={1}
                                    max={100}
                                />
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="space-y-2">
                                <Label>Slippage</Label>
                                <Input
                                    type="number"
                                    bind:value={buySlippage}
                                    min={0.001}
                                    max={0.1}
                                    step={0.001}
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Execution</Label>
                                <select
                                    bind:value={buyExecutionType}
                                    class="w-full h-10 px-3 rounded-md border bg-background"
                                >
                                    <option value="MARKET">MARKET</option>
                                    <option value="SYNC">SYNC</option>
                                    <option value="TWAP">TWAP</option>
                                </select>
                            </div>
                            <div class="flex items-end">
                                <Button
                                    onclick={buyPosition}
                                    disabled={buyingPosition ||
                                        buyUsdValue > userBalance}
                                    class="w-full"
                                >
                                    {buyingPosition
                                        ? "Opening..."
                                        : "Open Trade"}
                                </Button>
                            </div>
                        </div>
                    </Card.Content>
                </Card.Root>

                <!-- Open Positions -->
                {#if positions.length > 0}
                    <Card.Root>
                        <Card.Header>
                            <Card.Title>Your Positions</Card.Title>
                        </Card.Header>
                        <Card.Content>
                            <div class="space-y-2">
                                {#each positions as pos}
                                    {@const longAsset = pos.longAssets?.[0]}
                                    {@const shortAsset = pos.shortAssets?.[0]}
                                    {@const leverage = longAsset?.leverage ?? 1}
                                    <div
                                        class="flex items-center justify-between p-3 border rounded-md"
                                    >
                                        <div>
                                            <div class="font-bold">
                                                <span class="text-green-600"
                                                    >Long {longAsset?.coin ??
                                                        "?"}</span
                                                >
                                                <span
                                                    class="text-muted-foreground mx-1"
                                                    >/</span
                                                >
                                                <span class="text-red-600"
                                                    >Short {shortAsset?.coin ??
                                                        "?"}</span
                                                >
                                            </div>
                                            <span
                                                class="text-muted-foreground text-sm"
                                            >
                                                {leverage}x leverage
                                            </span>
                                        </div>
                                        <div class="text-right">
                                            <div class="font-mono">
                                                ${pos.marginUsed?.toFixed(2) ??
                                                    "0.00"}
                                            </div>
                                            <div
                                                class={pos.unrealizedPnl >= 0
                                                    ? "text-green-500"
                                                    : "text-red-500"}
                                            >
                                                {pos.unrealizedPnl >= 0
                                                    ? "+"
                                                    : ""}${pos.unrealizedPnl?.toFixed(
                                                    2,
                                                ) ?? "0.00"}
                                                <span class="text-xs ml-1">
                                                    ({pos.unrealizedPnlPercentage?.toFixed(
                                                        1,
                                                    ) ?? "0.0"}%)
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            onclick={() =>
                                                closePosition(pos.positionId)}
                                            variant="outline"
                                            size="sm"
                                            disabled={closingPositionId ===
                                                pos.positionId}
                                        >
                                            {closingPositionId ===
                                            pos.positionId
                                                ? "Closing..."
                                                : "Close"}
                                        </Button>
                                    </div>
                                {/each}
                            </div>
                        </Card.Content>
                    </Card.Root>
                {/if}
            {/if}

            <!-- Leaderboard -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="flex items-center gap-2">
                        <Trophy class="size-5" />
                        {activeLobby.status === "finished"
                            ? "Final Leaderboard"
                            : "Leaderboard"}
                    </Card.Title>
                </Card.Header>
                <Card.Content>
                    <div class="space-y-2">
                        {#each leaderboard as entry}
                            <div
                                class="flex items-center justify-between p-3 border rounded-md {entry.username ===
                                currentUser.username
                                    ? 'bg-muted'
                                    : ''}"
                            >
                                <div class="flex items-center gap-3">
                                    <span class="font-bold text-lg w-8"
                                        >#{entry.rank}</span
                                    >
                                    <span>{entry.username}</span>
                                </div>
                                <div class="text-right">
                                    <div class="font-mono">
                                        ${entry.totalValue.toFixed(2)}
                                    </div>
                                    <div
                                        class={entry.pnl >= 0
                                            ? "text-green-500 text-sm"
                                            : "text-red-500 text-sm"}
                                    >
                                        {entry.pnl >= 0
                                            ? "+"
                                            : ""}{entry.pnl.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                </Card.Content>
            </Card.Root>
        </div>
    {:else if step === "logged-in" && currentUser}
        <div class="mx-auto max-w-4xl space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-2xl font-bold">
                        Welcome, {currentUser.username}
                    </h1>
                    <p class="text-sm text-muted-foreground font-mono">
                        {shortenAddress(currentUser.walletAddress)}
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    {#if !showCreateLobby}
                        <Button
                            onclick={() => {
                                showCreateLobby = true;
                                newLobbyStartTime = getDefaultStartTime();
                            }}
                        >
                            <Plus class="size-4" />
                            New Lobby
                        </Button>
                    {/if}
                    <Button
                        onclick={logout}
                        variant="outline"
                        size="icon"
                        title="Disconnect"
                    >
                        <LogOut class="size-4" />
                    </Button>
                </div>
            </div>

            {#if error}
                <div
                    class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </div>
            {/if}

            <!-- Create Lobby Section -->
            {#if showCreateLobby}
                <Card.Root>
                    <Card.Header>
                        <Card.Title>Create New Lobby</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-4">
                        <div class="space-y-2">
                            <Label for="lobbyName">Lobby Name</Label>
                            <Input
                                id="lobbyName"
                                bind:value={newLobbyName}
                                placeholder="Enter lobby name"
                                disabled={creatingLobby}
                            />
                        </div>

                        <div class="space-y-2">
                            <Label for="startTime">Start Time</Label>
                            <Input
                                id="startTime"
                                type="datetime-local"
                                bind:value={newLobbyStartTime}
                                disabled={creatingLobby}
                            />
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <Label for="duration">Duration (minutes)</Label>
                                <Input
                                    id="duration"
                                    type="number"
                                    bind:value={newLobbyDuration}
                                    min={5}
                                    max={120}
                                    disabled={creatingLobby}
                                />
                            </div>
                            <div class="space-y-2">
                                <Label for="buyIn"
                                    >{newLobbyIsDemo
                                        ? "Starting Balance"
                                        : "Buy-in Amount"}</Label
                                >
                                <Input
                                    id="buyIn"
                                    type="number"
                                    bind:value={newLobbyBuyIn}
                                    min={100}
                                    disabled={creatingLobby}
                                />
                            </div>
                        </div>

                        <div
                            class="flex items-center gap-3 p-3 rounded-md border bg-muted/50"
                        >
                            <input
                                id="isDemo"
                                type="checkbox"
                                bind:checked={newLobbyIsDemo}
                                disabled={creatingLobby}
                                class="h-4 w-4"
                            />
                            <div>
                                <Label for="isDemo" class="cursor-pointer"
                                    >Demo Mode (Paper Trading)</Label
                                >
                                <p class="text-xs text-muted-foreground">
                                    {newLobbyIsDemo
                                        ? "No real money required. Players get paper money to trade."
                                        : "Real USDC payment required to join."}
                                </p>
                            </div>
                        </div>
                    </Card.Content>
                    <Card.Footer class="flex gap-2">
                        <Button
                            onclick={() => (showCreateLobby = false)}
                            variant="outline"
                            class="flex-1"
                        >
                            Cancel
                        </Button>
                        <Button
                            onclick={createLobby}
                            disabled={creatingLobby || !newLobbyName.trim()}
                            class="flex-1"
                        >
                            {#if creatingLobby}
                                Creating...
                            {:else}
                                Create Lobby
                            {/if}
                        </Button>
                    </Card.Footer>
                </Card.Root>
            {/if}

            <!-- Lobbies List -->
            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h2 class="text-xl font-semibold">Lobbies</h2>
                    <Button
                        onclick={loadLobbies}
                        variant="ghost"
                        size="sm"
                        disabled={loadingLobbies}
                    >
                        {#if loadingLobbies}
                            Loading...
                        {:else}
                            Refresh
                        {/if}
                    </Button>
                </div>

                {#if loadingLobbies && lobbies.length === 0}
                    <div class="text-center text-muted-foreground py-8">
                        Loading lobbies...
                    </div>
                {:else if lobbies.length === 0}
                    <Card.Root>
                        <Card.Content
                            class="py-8 text-center text-muted-foreground"
                        >
                            No lobbies yet. Create one to get started!
                        </Card.Content>
                    </Card.Root>
                {:else}
                    <div class="grid gap-4">
                        {#each lobbies as lobby}
                            <Card.Root>
                                <Card.Header>
                                    <div
                                        class="flex items-start justify-between"
                                    >
                                        <div>
                                            <Card.Title>{lobby.name}</Card.Title
                                            >
                                            <Card.Description>
                                                Created by {lobby.creatorName}
                                            </Card.Description>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            {#if lobby.isDemo}
                                                <span
                                                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                                >
                                                    DEMO
                                                </span>
                                            {/if}
                                            {#if lobby.hasJoined}
                                                <span
                                                    class="text-sm font-medium text-green-600 dark:text-green-400"
                                                >
                                                    Joined
                                                </span>
                                            {/if}
                                            <span
                                                class={`text-sm font-medium ${getStatusColor(lobby.status)}`}
                                            >
                                                {lobby.status}
                                            </span>
                                        </div>
                                    </div>
                                </Card.Header>
                                <Card.Content>
                                    <div class="grid grid-cols-2 gap-4 text-sm">
                                        <div>
                                            <span class="text-muted-foreground"
                                                >Buy-in:</span
                                            >
                                            <span class="ml-2 font-medium"
                                                >${lobby.buyIn}</span
                                            >
                                        </div>
                                        <div>
                                            <span class="text-muted-foreground"
                                                >Players:</span
                                            >
                                            <span class="ml-2 font-medium"
                                                >{lobby.participantCount}</span
                                            >
                                        </div>
                                        <div>
                                            <span class="text-muted-foreground"
                                                >Starts:</span
                                            >
                                            <span class="ml-2"
                                                >{formatDate(
                                                    lobby.startTime,
                                                )}</span
                                            >
                                        </div>
                                        <div>
                                            <span class="text-muted-foreground"
                                                >Ends:</span
                                            >
                                            <span class="ml-2"
                                                >{formatDate(
                                                    lobby.endTime,
                                                )}</span
                                            >
                                        </div>
                                    </div>
                                </Card.Content>
                                <Card.Footer>
                                    {#if lobby.status === "not started" && !lobby.hasJoined}
                                        <Button
                                            onclick={() => joinLobby(lobby)}
                                            disabled={joiningLobbyId ===
                                                lobby._id}
                                            class="w-full"
                                        >
                                            {#if joiningLobbyId === lobby._id}
                                                {lobby.isDemo
                                                    ? "Joining..."
                                                    : "Paying..."}
                                            {:else if lobby.isDemo}
                                                Join Demo (${lobby.buyIn} Paper)
                                            {:else}
                                                Join Lobby (${lobby.buyIn} USDC)
                                            {/if}
                                        </Button>
                                    {:else if lobby.hasJoined}
                                        <Button
                                            onclick={() => enterLobby(lobby)}
                                            class="w-full"
                                        >
                                            {lobby.isDemo
                                                ? "Trade (Demo)"
                                                : "Trade"}
                                        </Button>
                                    {/if}
                                </Card.Footer>
                            </Card.Root>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
