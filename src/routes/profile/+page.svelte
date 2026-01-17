<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { goto } from '$app/navigation';
	import pearPoolLogo from "$lib/assets/logo-bg-removebg-preview.png";
	import { convex, api } from "$lib/convex";
	import { auth } from "$lib/stores/auth";
	import { onMount } from "svelte";

	let walletAddress = $state('');
	let isConnecting = $state(false);
	let isConnected = $state(false);

	// Username state
	let username = $state('');
	let isSavingUsername = $state(false);
	let usernameError = $state<string | null>(null);
	let usernameSuccess = $state(false);

	// Load user data on mount
	onMount(async () => {
		const savedWallet = localStorage.getItem("walletAddress");
		
		if (savedWallet) {
			walletAddress = savedWallet;
			isConnected = true;
			
			// Load user data from Convex
			try {
				const user = await convex.query(api.auth.getUserByWallet, { 
					walletAddress: savedWallet 
				});
				if (user && user.username) {
					username = user.username;
				}
			} catch (err) {
				console.error("Failed to load user:", err);
			}
		}
	});

	async function connectMetaMask() {
		if (typeof window.ethereum === 'undefined') {
			alert('MetaMask is not installed. Please install MetaMask to connect your wallet.');
			return;
		}

		isConnecting = true;

		try {
			const accounts = await window.ethereum.request({ 
				method: 'eth_requestAccounts' 
			}) as string[];
			
			walletAddress = accounts[0];
			isConnected = true;
			localStorage.setItem("walletAddress", walletAddress);
			
			// Create or get user in Convex
			const result = await convex.mutation(api.auth.getOrCreateUser, {
				walletAddress: walletAddress
			});
			
			if (result.user.username) {
				username = result.user.username;
			}
			
			// Store token for session
			localStorage.setItem("token", result.token);
			
			console.log('Connected wallet:', walletAddress);
		} catch (error) {
			console.error('Failed to connect MetaMask:', error);
			alert('Failed to connect MetaMask. Please try again.');
		} finally {
			isConnecting = false;
		}
	}

	function handleDisconnectWallet() {
		walletAddress = '';
		isConnected = false;
		username = '';
		localStorage.removeItem("walletAddress");
		localStorage.removeItem("token");
	}

	async function handleLogout() {
		await auth.disconnectWallet();
		localStorage.removeItem("token");
		localStorage.removeItem("walletAddress");
		await goto('/');
	}

	async function saveUsername() {
		if (!walletAddress) {
			usernameError = "Please connect your wallet first";
			return;
		}

		if (!username.trim()) {
			usernameError = "Please enter a username";
			return;
		}

		isSavingUsername = true;
		usernameError = null;
		usernameSuccess = false;

		try {
			const result = await convex.mutation(api.auth.updateUsernameByWallet, {
				walletAddress: walletAddress,
				username: username,
			});
			username = result.username;
			usernameSuccess = true;
			
			// Hide success message after 3 seconds
			setTimeout(() => {
				usernameSuccess = false;
			}, 3000);
		} catch (err) {
			usernameError = err instanceof Error ? err.message : "Failed to save username";
		} finally {
			isSavingUsername = false;
		}
	}

	function formatAddress(address: string): string {
		if (!address) return '';
		return `${address.slice(0, 6)}...${address.slice(-4)}`;
	}
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-between">
			<div class="flex items-center gap-8">
				<div class="flex items-center">
					<img src={pearPoolLogo} alt="Pear Pool Logo" class="h-12 w-12 mr-1 object-contain" />
					<h1 class="text-xl font-light font-serif leading-none">
						<a href="/">Pear Pool</a>
					</h1>
				</div>
				<nav class="flex gap-4">
					<Button variant="ghost" href="/lobby">Back to Lobby</Button>
				</nav>
			</div>
			<Button variant="outline" onclick={handleLogout}>Logout</Button>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="max-w-2xl mx-auto space-y-8">
			<h2 class="text-3xl font-bold tracking-tight">Your Profile</h2>

			<!-- Username Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Username</Card.Title>
					<Card.Description>Choose a username to be displayed in games and leaderboards</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-4">
						<div class="grid gap-2">
							<Label for="username">Username</Label>
							<div class="flex gap-2">
								<Input 
									id="username" 
									bind:value={username} 
									placeholder="Enter username (3-20 characters)"
									disabled={!isConnected}
								/>
								<Button 
									onclick={saveUsername} 
									disabled={isSavingUsername || !isConnected}
								>
									{isSavingUsername ? 'Saving...' : 'Save'}
								</Button>
							</div>
							{#if usernameError}
								<p class="text-sm text-red-500">{usernameError}</p>
							{/if}
							{#if usernameSuccess}
								<p class="text-sm text-green-500">Username saved successfully!</p>
							{/if}
							<p class="text-xs text-muted-foreground">
								Only letters, numbers, and underscores allowed (3-20 characters)
							</p>
							{#if !isConnected}
								<p class="text-sm text-amber-500">Connect your wallet below to set a username</p>
							{/if}
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<!-- Wallet Connection Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Wallet Connection</Card.Title>
					<Card.Description>
						Connect your MetaMask wallet to participate in trading games
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if isConnected}
						<div class="space-y-4">
							<div class="flex items-center justify-between p-4 bg-muted rounded-lg">
								<div class="flex items-center gap-3">
									<div class="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center">
										<span class="text-white text-lg">🦊</span>
									</div>
									<div>
										<p class="font-medium">MetaMask</p>
										<p class="text-sm text-muted-foreground font-mono">
											{formatAddress(walletAddress)}
										</p>
									</div>
								</div>
								<span class="text-green-500 text-sm font-medium">Connected</span>
							</div>
							<div class="grid gap-2">
								<Label>Full Wallet Address</Label>
								<Input value={walletAddress} disabled class="font-mono text-sm" />
							</div>
						</div>
					{:else}
						<div class="text-center py-8 space-y-4">
							<div class="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
								<span class="text-3xl">🦊</span>
							</div>
							<p class="text-muted-foreground">
								No wallet connected. Connect your MetaMask wallet to start trading.
							</p>
						</div>
					{/if}
				</Card.Content>
				<Card.Footer>
					{#if isConnected}
						<Button variant="outline" class="w-full" onclick={handleDisconnectWallet}>
							Disconnect Wallet
						</Button>
					{:else}
						<Button class="w-full" onclick={connectMetaMask} disabled={isConnecting}>
							{isConnecting ? 'Connecting...' : 'Connect MetaMask'}
						</Button>
					{/if}
				</Card.Footer>
			</Card.Root>

			<!-- Trading Stats Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Trading Stats</Card.Title>
					<Card.Description>Your performance in Pear Pool</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="grid grid-cols-3 gap-4 text-center">
						<div class="space-y-1">
							<p class="text-2xl font-bold">12</p>
							<p class="text-sm text-muted-foreground">Games Played</p>
						</div>
						<div class="space-y-1">
							<p class="text-2xl font-bold text-green-500">$2,450</p>
							<p class="text-sm text-muted-foreground">Total Winnings</p>
						</div>
						<div class="space-y-1">
							<p class="text-2xl font-bold">67%</p>
							<p class="text-sm text-muted-foreground">Win Rate</p>
						</div>
					</div>
				</Card.Content>
			</Card.Root>
		</div>
	</main>
</div>
