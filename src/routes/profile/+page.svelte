<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { goto } from '$app/navigation';

	let walletAddress = $state('');
	let isConnecting = $state(false);
	let isConnected = $state(false);

	// Mock user data - replace with actual auth data later
	let user = $state({
		name: 'John Doe',
		email: 'john@example.com'
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
	}

	async function handleLogout() {
		await goto('/');
	}

	function formatAddress(address: string): string {
		if (!address) return '';
		return `${address.slice(0, 6)}...${address.slice(-4)}`;
	}
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-between">
			<h1 class="text-2xl font-bold">
				<a href="/">Pear Pool</a>
			</h1>
			<nav class="flex gap-4">
				<Button variant="ghost" href="/lobby">Back to Lobby</Button>
				<Button variant="outline" onclick={handleLogout}>Logout</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="max-w-2xl mx-auto space-y-8">
			<h2 class="text-3xl font-bold tracking-tight">Your Profile</h2>

			<!-- Account Info Card -->
			<Card.Root>
				<Card.Header>
					<Card.Title>Account Information</Card.Title>
					<Card.Description>Your login details</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="space-y-4">
						<div class="grid gap-2">
							<Label for="profile-name">Name</Label>
							<Input id="profile-name" value={user.name} disabled />
						</div>
						<div class="grid gap-2">
							<Label for="profile-email">Email</Label>
							<Input id="profile-email" value={user.email} disabled />
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
