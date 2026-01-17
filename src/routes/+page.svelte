<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Card from "$lib/components/ui/card";
    import { convex, api } from "$lib/convex";
    import { auth } from "$lib/stores/auth";

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

    onMount(async () => {
        // Check if user was previously logged in
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
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to create account";
        } finally {
            loading = false;
        }
    }

    function logout() {
        auth.logout();
        currentUser = null;
        walletAddress = "";
        username = "";
        step = "connect";
    }

    function shortenAddress(address: string) {
        return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
    <Card.Root class="w-full max-w-md">
        <Card.Header>
            <Card.Title class="text-center text-2xl">
                {#if step === "connect"}
                    Connect Wallet
                {:else if step === "register"}
                    Create Account
                {:else}
                    Welcome Back
                {/if}
            </Card.Title>
            <Card.Description class="text-center">
                {#if step === "connect"}
                    Connect your MetaMask wallet to continue
                {:else if step === "register"}
                    Choose a username for your account
                {:else}
                    You're logged in
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
                        onkeydown={(e) => e.key === "Enter" && register()}
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
            {:else if step === "logged-in" && currentUser}
                <div class="space-y-4">
                    <div class="space-y-2">
                        <Label>Username</Label>
                        <div
                            class="rounded-md border bg-muted/50 p-3 text-sm font-medium"
                        >
                            {currentUser.username || "No username set"}
                        </div>
                    </div>

                    <div class="space-y-2">
                        <Label>Wallet Address</Label>
                        <div
                            class="rounded-md border bg-muted/50 p-3 text-sm font-mono"
                        >
                            {shortenAddress(currentUser.walletAddress)}
                        </div>
                    </div>
                </div>
            {/if}
        </Card.Content>

        {#if step === "logged-in"}
            <Card.Footer>
                <Button onclick={logout} variant="outline" class="w-full">
                    Disconnect
                </Button>
            </Card.Footer>
        {/if}
    </Card.Root>
</div>
