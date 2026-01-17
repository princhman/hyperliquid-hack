<script lang="ts">
    import { Button } from '$lib/components/ui/button';
    import * as Card from '$lib/components/ui/card';
    import { Input } from '$lib/components/ui/input';
    import { Label } from '$lib/components/ui/label';
    import { convex, api } from '$lib/convex';
    import { sendUSDC } from '../../convex/buyIn/buyIn';
    import { connectWagmi, disconnectWagmi } from '../../convex/buyIn/config';

    // Hardcoded recipient from environment variable
    const RECIPIENT_ADDRESS = import.meta.env.VITE_RECIPIENT_ADDRESS as `0x${string}`;

    let isConnecting = $state(false);
    let isSavingUsername = $state(false);
    let error = $state('');
    let usernameInput = $state('');
    let user = $state<{
        walletAddress: string;
        username?: string;
        isNewUser: boolean;
    } | null>(null);

    // Transfer state
    let amount = $state('');
    let isSending = $state(false);
    let txHash = $state('');

    async function connectWallet() {
        isConnecting = true;
        error = '';

        try {
            // Check if MetaMask is installed
            if (typeof window.ethereum === 'undefined') {
                throw new Error('Please install MetaMask to connect your wallet');
            }

            // Connect through wagmi FIRST (this is the fix!)
            const wagmiResult = await connectWagmi();
            console.log('Wagmi connected:', wagmiResult);

            const walletAddress = wagmiResult.accounts[0];

            // Login with Convex
            const result = await convex.mutation(api.auth.loginWithWallet, {
                walletAddress
            });

            user = result;
            usernameInput = result.username ?? '';
            console.log('Logged in:', result);

            localStorage.setItem('walletAddress', walletAddress);
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to connect wallet';
            console.error('Login error:', err);
        } finally {
            isConnecting = false;
        }
    }

    async function saveUsername() {
        if (!user || !usernameInput.trim()) return;

        isSavingUsername = true;
        error = '';

        try {
            await convex.mutation(api.auth.updateUsername, {
                walletAddress: user.walletAddress,
                username: usernameInput.trim()
            });

            user = { ...user, username: usernameInput.trim() };
            console.log('Username saved:', usernameInput);
        } catch (err) {
            error = err instanceof Error ? err.message : 'Failed to save username';
            console.error('Save username error:', err);
        } finally {
            isSavingUsername = false;
        }
    }

    async function handleTransfer() {
        if (!amount) {
            error = 'Please enter amount';
            return;
        }

        if (!RECIPIENT_ADDRESS) {
            error = 'Recipient address not configured';
            return;
        }

        isSending = true;
        error = '';
        txHash = '';

        try {
            const hash = await sendUSDC(RECIPIENT_ADDRESS, amount);
            txHash = hash;
            console.log('Transfer successful:', hash);
        } catch (err) {
            error = err instanceof Error ? err.message : 'Transfer failed';
            console.error('Transfer error:', err);
        } finally {
            isSending = false;
        }
    }

    async function disconnect() {
        await disconnectWagmi();  // Disconnect wagmi too
        user = null;
        usernameInput = '';
        amount = '';
        txHash = '';
        localStorage.removeItem('walletAddress');
    }

    // Check for existing session on mount
    $effect(() => {
        const savedWallet = localStorage.getItem('walletAddress');
        if (savedWallet) {
            // Reconnect wagmi on page reload
            connectWagmi().catch(console.error);
            
            convex.query(api.auth.getUserByWallet, { walletAddress: savedWallet }).then((result) => {
                if (result) {
                    user = {
                        walletAddress: result.walletAddress,
                        username: result.username,
                        isNewUser: false
                    };
                    usernameInput = result.username ?? '';
                }
            });
        }
    });
</script>

<!-- Rest of your HTML stays the same -->
<div class="flex min-h-screen items-center justify-center bg-background p-4">
    <Card.Root class="w-full max-w-md">
        <Card.Header class="space-y-1 text-center">
            <Card.Title class="text-2xl font-bold">
                {user ? 'Welcome!' : 'Connect Wallet'}
            </Card.Title>
            <Card.Description>
                {user
                    ? `Connected as ${user.walletAddress.slice(0, 6)}...${user.walletAddress.slice(-4)}`
                    : 'Connect your wallet to get started'}
            </Card.Description>
        </Card.Header>
        <Card.Content class="space-y-4">
            {#if error}
                <p class="text-sm text-destructive text-center">{error}</p>
            {/if}

            {#if user}
                <div class="space-y-4">
                    <div class="rounded-lg border p-4 text-center">
                        <p class="text-sm text-muted-foreground">Wallet Address</p>
                        <p class="font-mono text-sm break-all">{user.walletAddress}</p>
                    </div>

                    <div class="space-y-2">
                        <Label for="username">Username</Label>
                        <div class="flex gap-2">
                            <Input
                                id="username"
                                type="text"
                                placeholder="Enter your username"
                                bind:value={usernameInput}
                                maxlength={32}
                            />
                            <Button
                                onclick={saveUsername}
                                disabled={isSavingUsername || !usernameInput.trim()}
                            >
                                {#if isSavingUsername}
                                    Saving...
                                {:else}
                                    Save
                                {/if}
                            </Button>
                        </div>
                        {#if user.username}
                            <p class="text-xs text-muted-foreground">
                                Current: <span class="font-medium">{user.username}</span>
                            </p>
                        {/if}
                    </div>

                    <!-- USDC Transfer Section -->
                    <div class="rounded-lg border p-4 space-y-3">
                        <h3 class="font-semibold text-center">Buy In</h3>

                        <div class="space-y-2">
                            <Label for="amount">Amount (USDC)</Label>
                            <Input
                                id="amount"
                                type="text"
                                placeholder="10.00"
                                bind:value={amount}
                            />
                        </div>

                        <Button
                            onclick={handleTransfer}
                            class="w-full"
                            disabled={isSending || !amount}
                        >
                            {#if isSending}
                                Sending...
                            {:else}
                                Send USDC
                            {/if}
                        </Button>

                        {#if txHash}
                            <div class="text-center text-sm">
                                <p class="text-green-600">✅ Sent successfully!</p>
                                <a
                                    href="https://arbiscan.io/tx/{txHash}"
                                    target="_blank"
                                    class="text-blue-500 underline break-all"
                                >
                                    View transaction
                                </a>
                            </div>
                        {/if}
                    </div>

                    <a href="/create" class="block">
                        <Button class="w-full">Go to Lobby Creation</Button>
                    </a>
                    <Button onclick={disconnect} variant="outline" class="w-full">
                        Disconnect
                    </Button>
                </div>
            {:else}
                <Button onclick={connectWallet} class="w-full" disabled={isConnecting}>
                    {#if isConnecting}
                        Connecting...
                    {:else}
                        Connect with MetaMask
                    {/if}
                </Button>
            {/if}
        </Card.Content>
        <Card.Footer class="text-center text-sm">
            <p class="text-muted-foreground w-full">
                By connecting, you agree to our Terms of Service
            </p>
        </Card.Footer>
    </Card.Root>
</div>