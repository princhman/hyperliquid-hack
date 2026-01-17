<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as Card from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { convex, api } from '$lib/convex';
    import { goto } from '$app/navigation';
    import { sendUSDC } from '../../convex/buyIn/buyIn';
    import { getAccount, connect } from '@wagmi/core';
    import { config } from '../../convex/buyIn/config';
    import { injected } from '@wagmi/connectors';
    import { onMount } from 'svelte';
    import { derived, writable } from 'svelte/store';

    // Hardcoded recipient from environment variable
    const RECIPIENT_ADDRESS = import.meta.env.VITE_RECIPIENT_ADDRESS as `0x${string}`;

    let isCreating = $state(false);
    let isConnecting = $state(false);
    let error = $state('');
    let success = $state('');
    let statusMessage = $state('');
    let walletConnected = $state(false);
    let walletAddress = $state('');

    // Form fields
    let name = $state('');
    let startDate = $state('');
    let startTime = $state('');
    let endDate = $state('');
    let endTime = $state('');
    let buyIn = $state('');
    let split = $state<number | null>(null);  // NEW: Split selection

    // Split options
    const splitOptions = [
        { value: 1, label: 'Winner Takes All', description: '100% to 1st' },
        { value: 0.75, label: 'Top 2', description: '75% / 25%' },
        { value: 0.6, label: 'Top 3', description: '60% / 25% / 15%' },
    ];

    // Lobbies state
    type Lobby = {
        _id: string;
        name: string;
        buyIn: number;
        startTime: number;
        endTime: number;
        split?: number;
    };
    type User = {
        _id: string;
        _creationTime: number;
        username?: string;
        lastLoginAt?: number;
        walletStatus?: 'ACTIVE' | 'EXPIRED' | 'NOT_FOUND';
        walletAddress: string;
        createdAt: number;
    };
    let lobbies = $state<Lobby[]>([]);
    let loadingLobbies = $state(true);
    let selectedLobbyId = $state<string>('');
    let usersInLobby = $state<User[]>([]);
    let joiningLobbyId = $state<string>('');

    // Fetch lobbies on mount and after create/join
    async function fetchLobbies() {
      loadingLobbies = true;
      try {
        lobbies = await convex.query(api.lobby.getLobbies, {});
      } catch (e) {
        console.error('Failed to fetch lobbies', e);
      } finally {
        loadingLobbies = false;
      }
    }

    onMount(fetchLobbies);

    // Convex Id type helper
    type LobbyId = string & { __tableName: 'lobby' };

    // Join a lobby
    async function joinLobby(lobbyId: string) {
        if (!walletConnected || !walletAddress) {
            error = 'Connect your wallet to join.';
            return;
        }
        joiningLobbyId = lobbyId;
        error = '';
        try {
            await convex.mutation(api.lobby.joinLobby, {
                walletAddress,
                lobbyId: lobbyId as LobbyId,
            });
            selectedLobbyId = lobbyId;
            await fetchUsersInLobby(lobbyId);
            await fetchLobbies();
        } catch (e: any) {
            error = e?.message || 'Failed to join lobby.';
        } finally {
            joiningLobbyId = '';
        }
    }

    // Fetch users in a lobby
    async function fetchUsersInLobby(lobbyId: string) {
        try {
            const result = await convex.query(api.lobby.getUsersInLobby, { lobbyId: lobbyId as LobbyId }) as (User | null)[];
            usersInLobby = (result ?? []).filter((u): u is User => u !== null);
            
        } catch (e) {
            usersInLobby = [];
        }
    }

    // Show users when selecting a lobby
    async function selectLobby(lobbyId: string) {
        selectedLobbyId = lobbyId;
        await fetchUsersInLobby(lobbyId);
    }

    // Check wallet connection on mount
    $effect(() => {
        const account = getAccount(config);
        walletConnected = account.isConnected;
        walletAddress = account.address || '';
        console.log('Wallet status:', { connected: walletConnected, address: walletAddress });
    });

    async function connectWallet() {
        isConnecting = true;
        error = '';
        
        try {
            console.log('Connecting wallet...');
            const result = await connect(config, {
                connector: injected(),
            });
            
            console.log('Wallet connected:', result);
            walletConnected = true;
            walletAddress = result.accounts[0] || '';
            
            // Store in localStorage for convenience
            if (walletAddress) {
                localStorage.setItem('walletAddress', walletAddress);
            }
        } catch (err) {
            console.error('Connection error:', err);
            if (err instanceof Error) {
                if (err.message.includes('User rejected')) {
                    error = 'Connection rejected. Please approve in your wallet.';
                } else if (err.message.includes('No injected provider')) {
                    error = 'No wallet found. Please install MetaMask.';
                } else {
                    error = 'Failed to connect wallet: ' + err.message;
                }
            } else {
                error = 'Failed to connect wallet';
            }
        } finally {
            isConnecting = false;
        }
    }

    async function createLobby() {
        error = '';
        success = '';
        statusMessage = '';

        console.log('Starting createLobby with buyIn:', buyIn);

        // Validate fields
        if (!name.trim()) {
            error = 'Please enter a lobby name';
            return;
        }
        if (!startDate || !startTime) {
            error = 'Please select a start date and time';
            return;
        }
        if (!endDate || !endTime) {
            error = 'Please select an end date and time';
            return;
        }
        if (!buyIn || parseFloat(buyIn) <= 0) {
            error = 'Please enter a valid buy-in amount';
            return;
        }
        if (split === null) {
            error = 'Please select a prize split';
            return;
        }

        if (!RECIPIENT_ADDRESS) {
            error = 'Recipient address not configured. Please set VITE_RECIPIENT_ADDRESS in your .env file';
            console.error('RECIPIENT_ADDRESS is not set:', RECIPIENT_ADDRESS);
            return;
        }

        // Check wallet connection via wagmi
        const account = getAccount(config);
        if (!account.isConnected || !account.address) {
            error = 'Please connect your wallet first';
            return;
        }

        const connectedAddress = account.address;

        // Convert to timestamps
        const startTimestamp = new Date(`${startDate}T${startTime}`).getTime();
        const endTimestamp = new Date(`${endDate}T${endTime}`).getTime();

        if (endTimestamp <= startTimestamp) {
            error = 'End time must be after start time';
            return;
        }

        isCreating = true;

        try {
            // Step 1: Send USDC payment first
            statusMessage = 'Sending USDC payment...';
            const amountToSend = String(buyIn);
            console.log('Attempting to send USDC:', {
                recipient: RECIPIENT_ADDRESS,
                amount: amountToSend,
                amountType: typeof amountToSend,
                originalBuyIn: buyIn,
                originalType: typeof buyIn
            });

            const txHash = await sendUSDC(RECIPIENT_ADDRESS, amountToSend);
            console.log('Transfer successful! Transaction hash:', txHash);
            statusMessage = 'Payment confirmed!';

            // Step 2: Create lobby only after successful payment
            statusMessage = 'Creating lobby in database...';
            const result = await convex.mutation(api.lobby.createLobby, {
                name: name.trim(),
                walletAddress: connectedAddress,
                startTime: startTimestamp,
                endTime: endTimestamp,
                buyIn: parseFloat(buyIn),
                split: split,  // NEW: Pass split value
            });

            success = `Lobby "${result.name}" created successfully! Transaction: ${txHash.substring(0, 10)}...`;
            console.log('Lobby created:', result);

            // Reset form
            name = '';
            startDate = '';
            startTime = '';
            endDate = '';
            endTime = '';
            buyIn = '';
            split = null;  // NEW: Reset split

            // Refresh lobbies list
            await fetchLobbies();

            // Redirect after delay
            setTimeout(() => {
                goto('/');
            }, 2500);
        } catch (err) {
            console.error('Full error object:', err);
            
            // Extract clean error message
            if (err instanceof Error) {
                console.error('Error message:', err.message);
                console.error('Error stack:', err.stack);
                
                // Check for specific wallet/payment errors
                if (err.message.includes('User rejected') || err.message.includes('user rejected')) {
                    error = 'Payment cancelled by user';
                } else if (err.message.includes('insufficient funds') || err.message.includes('insufficient balance')) {
                    error = 'Insufficient USDC balance. Please add USDC to your wallet.';
                } else if (err.message.includes('Wallet not connected')) {
                    error = 'Wallet not connected. Please connect your wallet and try again.';
                } else if (err.message.includes('chain') || err.message.includes('network') || err.message.includes('switch')) {
                    error = 'Wrong network detected. Please switch to Arbitrum network in your wallet.';
                } else if (err.message.includes('USDC not supported')) {
                    error = 'USDC not supported on this network. Please switch to Arbitrum.';
                } else {
                    const match = err.message.match(/Error: ([^]+?)(?:\s+at\s+|$)/);
                    error = match ? match[1].trim() : err.message;
                }
            } else {
                error = 'An unexpected error occurred. Please try again.';
            }
            
            // Don't redirect on error - let user fix the issue
            statusMessage = '';
        } finally {
            isCreating = false;
        }
    }

    // Helper to display split info
    function getSplitLabel(splitValue: number | undefined): string {
        if (splitValue === undefined) return 'Not set';
        const option = splitOptions.find(o => o.value === splitValue);
        return option ? option.label : `${splitValue * 100}%`;
    }
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
    <Card.Root class="w-full max-w-md">
        <Card.Header class="space-y-1 text-center">
            <Card.Title class="text-2xl font-bold">Create Lobby</Card.Title>
            <Card.Description>Start a new trading competition</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
            {#if !walletConnected}
                <div class="rounded-lg bg-yellow-50 border border-yellow-200 p-4 text-center space-y-3">
                    <p class="text-sm text-yellow-800">
                        Please connect your wallet to create a lobby
                    </p>
                    <Button onclick={connectWallet} disabled={isConnecting} class="w-full">
                        {#if isConnecting}
                            Connecting...
                        {:else}
                            Connect Wallet
                        {/if}
                    </Button>
                </div>
            {:else}
                <div class="rounded-lg bg-green-50 border border-green-200 p-3 text-center">
                    <p class="text-xs text-green-600">
                        Connected: {walletAddress.substring(0, 6)}...{walletAddress.substring(38)}
                    </p>
                </div>
            {/if}

            {#if error}
                <div class="rounded-lg bg-destructive/10 p-3 text-sm text-destructive text-center">
                    {error}
                </div>
            {/if}
            {#if success}
                <div class="rounded-lg bg-green-50 p-3 text-sm text-green-700 text-center">
                    {success}
                </div>
            {/if}
            {#if statusMessage && !success && !error}
                <div class="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 text-center">
                    {statusMessage}
                </div>
            {/if}

            <div class="space-y-2">
                <Label for="name">Lobby Name</Label>
                <Input
                    id="name"
                    type="text"
                    placeholder="Enter lobby name"
                    bind:value={name}
                    maxlength={50}
                    disabled={isCreating || !walletConnected}
                />
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                    <Label for="startDate">Start Date</Label>
                    <Input id="startDate" type="date" bind:value={startDate} disabled={isCreating || !walletConnected} />
                </div>
                <div class="space-y-2">
                    <Label for="startTime">Start Time</Label>
                    <Input id="startTime" type="time" bind:value={startTime} disabled={isCreating || !walletConnected} />
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                    <Label for="endDate">End Date</Label>
                    <Input id="endDate" type="date" bind:value={endDate} disabled={isCreating || !walletConnected} />
                </div>
                <div class="space-y-2">
                    <Label for="endTime">End Time</Label>
                    <Input id="endTime" type="time" bind:value={endTime} disabled={isCreating || !walletConnected} />
                </div>
            </div>

            <div class="space-y-2">
                <Label for="buyIn">Buy-in Amount (USDC)</Label>
                <Input
                    id="buyIn"
                    type="number"
                    placeholder="0.00"
                    bind:value={buyIn}
                    min="0"
                    step="0.01"
                    disabled={isCreating || !walletConnected}
                />
                <p class="text-xs text-muted-foreground">
                    This amount will be sent to the treasury wallet on Arbitrum
                </p>
            </div>

            <!-- NEW: Prize Split Selection -->
            <div class="space-y-2">
                <Label>Prize Split</Label>
                <div class="grid grid-cols-3 gap-2">
                    {#each splitOptions as option}
                        <button
                            type="button"
                            onclick={() => split = option.value}
                            disabled={isCreating || !walletConnected}
                            class="p-3 rounded-lg border-2 text-center transition-all
                                {split === option.value 
                                    ? 'border-primary bg-primary/10 ring-2 ring-primary/20' 
                                    : 'border-muted hover:border-primary/50'}
                                {isCreating || !walletConnected ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
                        >
                            <div class="font-semibold text-xs">{option.label}</div>
                            <div class="text-[10px] text-muted-foreground mt-1">{option.description}</div>
                        </button>
                    {/each}
                </div>
            </div>

            <Button onclick={createLobby} class="w-full" disabled={isCreating || !walletConnected || split === null}>
                {#if isCreating}
                    <span class="flex items-center gap-2">
                        <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
                        {statusMessage || 'Processing...'}
                    </span>
                {:else}
                    Create Lobby & Pay {buyIn ? `${buyIn} USDC` : 'Buy-in'}
                {/if}
            </Button>
        </Card.Content>
        <Card.Footer class="text-center text-sm">
            <a href="/" class="text-muted-foreground hover:underline w-full block">
                ← Back to Home
            </a>
        </Card.Footer>
    </Card.Root>

    <!-- Lobbies List -->
    <Card.Root class="w-full max-w-2xl mt-8">
        <Card.Header class="space-y-1 text-center">
            <Card.Title class="text-xl font-bold">Available Lobbies</Card.Title>
            <Card.Description>Join a lobby to compete</Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
            {#if loadingLobbies}
                <div class="text-center text-muted-foreground">Loading lobbies...</div>
            {:else if lobbies.length === 0}
                <div class="text-center text-muted-foreground">No lobbies available.</div>
            {:else}
                <div class="space-y-4">
                    {#each lobbies as lobby}
                        <div class="border rounded-lg p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 {selectedLobbyId === lobby._id ? 'bg-blue-50' : ''}">
                            <div>
                                <div class="font-semibold">{lobby.name}</div>
                                <div class="text-xs text-muted-foreground">Buy-in: {lobby.buyIn} USDC</div>
                                <div class="text-xs text-muted-foreground">Split: {getSplitLabel(lobby.split)}</div>
                                <div class="text-xs text-muted-foreground">Start: {new Date(lobby.startTime).toLocaleString()}</div>
                                <div class="text-xs text-muted-foreground">End: {new Date(lobby.endTime).toLocaleString()}</div>
                            </div>
                            <div class="flex flex-col gap-2 items-end">
                                <Button
                                    disabled={!walletConnected || joiningLobbyId === lobby._id}
                                    onclick={() => joinLobby(lobby._id)}
                                    class="w-28"
                                >
                                    {joiningLobbyId === lobby._id ? 'Joining...' : 'Join'}
                                </Button>
                                <Button
                                    variant="secondary"
                                    onclick={() => selectLobby(lobby._id)}
                                    class="w-28"
                                >
                                    View Users
                                </Button>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}

            {#if selectedLobbyId && usersInLobby.length > 0}
                <div class="mt-6">
                    <div class="font-semibold mb-2 text-center">Users in Lobby</div>
                    <ul class="space-y-1">
                        {#each usersInLobby as user}
                            <li class="text-xs text-muted-foreground text-center">{user.username || user.walletAddress}</li>
                        {/each}
                    </ul>
                </div>
            {/if}
        </Card.Content>
    </Card.Root>
</div>