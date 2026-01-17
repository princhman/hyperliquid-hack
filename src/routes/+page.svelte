<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Card from "$lib/components/ui/card";
    import { convex, api } from "$lib/convex";
    import { auth } from "$lib/stores/auth";
    import type { Id } from "../convex/_generated/dataModel";
    import type { FunctionReturnType } from "convex/server";
    import { LogOut, Plus } from "@lucide/svelte";

    type Lobby = FunctionReturnType<typeof api.lobby.getLobbies>[number];

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
    let newLobbyBuyIn = $state(1000);
    let newLobbyStartTime = $state("");
    let newLobbyDuration = $state(30); // minutes
    let creatingLobby = $state(false);

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
        const storedWallet = auth.setFromStorage();
        if (storedWallet) {
            await checkExistingUser(storedWallet);
        }
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
            });

            newLobbyName = "";
            newLobbyBuyIn = 1000;
            newLobbyStartTime = "";
            newLobbyDuration = 30;
            showCreateLobby = false;
            await loadLobbies();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to create lobby";
        } finally {
            creatingLobby = false;
        }
    }

    async function joinLobby(lobbyId: Id<"lobby">) {
        if (!currentUser) return;

        joiningLobbyId = lobbyId;
        error = "";

        try {
            await convex.mutation(api.lobby.joinLobby, {
                userId: currentUser.id as Id<"users">,
                lobbyId,
                walletAddress: currentUser.walletAddress,
            });
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
                                <Label for="buyIn">Buy-in Amount</Label>
                                <Input
                                    id="buyIn"
                                    type="number"
                                    bind:value={newLobbyBuyIn}
                                    min={100}
                                    disabled={creatingLobby}
                                />
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
                                {#if lobby.status === "not started" && !lobby.hasJoined}
                                    <Card.Footer>
                                        <Button
                                            onclick={() => joinLobby(lobby._id)}
                                            disabled={joiningLobbyId ===
                                                lobby._id}
                                            class="w-full"
                                        >
                                            {#if joiningLobbyId === lobby._id}
                                                Joining...
                                            {:else}
                                                Join Lobby
                                            {/if}
                                        </Button>
                                    </Card.Footer>
                                {/if}
                            </Card.Root>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
