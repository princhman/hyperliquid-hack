<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import pearPoolLogo from "$lib/assets/logo-bg-removebg-preview.png";
	import { convex, api } from "$lib/convex";
	import { auth } from "$lib/stores/auth";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import type { Id } from "../../../convex/_generated/dataModel";

	// State
	let walletAddress = $state<string | null>(null);
	let games = $state<any[]>([]);
	let userGames = $state<any[]>([]);
	let isLoading = $state(true);
	let showCreateModal = $state(false);
	let isCreating = $state(false);
	let isJoining = $state<string | null>(null);
	let error = $state<string | null>(null);
	let showHowItWorks = $state(false);
	let showProfileMenu = $state(false);

	// Create game form
	let gameName = $state("");
	let gameDescription = $state("");
	let maxPlayers = $state(10);
	let startingCapital = $state(10000);
	let entryFee = $state(100);
	let prizeDistribution = $state("winner-takes-all");
	let durationMinutes = $state(60);

	onMount(async () => {
		walletAddress = localStorage.getItem("walletAddress");
		if (!walletAddress) {
			goto("/");
			return;
		}
		await loadGames();
	});

	async function loadGames() {
		isLoading = true;
		try {
			const [allGames, myGames] = await Promise.all([
				convex.query(api.games.listGames, {}),
				convex.query(api.games.getUserGames, { walletAddress: walletAddress! }),
			]);
			games = allGames.filter((g: any) => g.status === "waiting" || g.status === "active");
			userGames = myGames;
		} catch (err) {
			console.error("Failed to load games:", err);
			error = "Failed to load games";
		} finally {
			isLoading = false;
		}
	}

	async function handleCreateGame() {
		if (!walletAddress || !gameName.trim()) return;
		isCreating = true;
		error = null;

		try {
			await convex.mutation(api.games.createGame, {
				walletAddress,
				name: gameName.trim(),
				description: gameDescription.trim() || undefined,
				maxPlayers,
				startingCapital,
				entryFee,
				prizeDistribution,
				durationMinutes,
				tradingPairs: [], // Players select their own coins in-game
			});
			showCreateModal = false;
			resetForm();
			await loadGames();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to create game";
		} finally {
			isCreating = false;
		}
	}

	async function handleJoinGame(gameId: Id<"games">) {
		if (!walletAddress) return;
		isJoining = gameId;
		error = null;

		try {
			await convex.mutation(api.games.joinGame, {
				walletAddress,
				gameId,
			});
			await loadGames();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to join game";
		} finally {
			isJoining = null;
		}
	}

	async function handleStartGame(gameId: Id<"games">) {
		if (!walletAddress) return;
		error = null;

		try {
			await convex.mutation(api.games.startGame, {
				walletAddress,
				gameId,
			});
			await loadGames();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to start game";
		}
	}

	async function handleLeaveGame(gameId: Id<"games">) {
		if (!walletAddress) return;
		error = null;

		try {
			await convex.mutation(api.games.leaveGame, {
				walletAddress,
				gameId,
			});
			await loadGames();
		} catch (err) {
			error = err instanceof Error ? err.message : "Failed to leave game";
		}
	}

	function resetForm() {
		gameName = "";
		gameDescription = "";
		maxPlayers = 10;
		startingCapital = 10000;
		entryFee = 100;
		prizeDistribution = "winner-takes-all";
		durationMinutes = 60;
	}

	function formatDuration(minutes: number): string {
		if (minutes < 60) return `${minutes}m`;
		const hours = Math.floor(minutes / 60);
		const mins = minutes % 60;
		return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
	}

	function formatTimeLeft(endsAt: number | undefined): string {
		if (!endsAt) return "Not started";
		const now = Date.now();
		const diff = endsAt - now;
		if (diff <= 0) return "Ended";
		const hours = Math.floor(diff / (1000 * 60 * 60));
		const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
		return `${hours}h ${minutes}m`;
	}

	function isUserInGame(gameId: string): boolean {
		return userGames.some((g) => g._id === gameId);
	}

	function isUserCreator(game: any): boolean {
		return userGames.some((g) => g._id === game._id && g.creatorId === game.creatorId);
	}

	async function handleLogout() {
		await auth.disconnectWallet();
		localStorage.removeItem("walletAddress");
		localStorage.removeItem("token");
		goto("/");
	}
</script>

<div class="min-h-screen bg-background flex flex-col relative">
	<div class="absolute top-4 right-4 z-50">
		<button
			class="w-10 h-10 rounded-full bg-secondary overflow-hidden hover:ring-2 hover:ring-primary transition-all focus:outline-none flex items-center justify-center"
			onclick={() => (showProfileMenu = !showProfileMenu)}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="currentColor"
				class="w-6 h-6 text-green-500"
			>
				<path
					fill-rule="evenodd"
					d="M7.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM3.751 20.105a8.25 8.25 0 0 1 16.498 0 .75.75 0 0 1-.437.695A18.683 18.683 0 0 1 12 22.5c-2.786 0-5.433-.608-7.812-1.7a.75.75 0 0 1-.437-.695Z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>

		{#if showProfileMenu}
			<div class="absolute right-0 mt-2 w-48 bg-card border rounded-lg shadow-lg py-1 z-50">
				<a
					href="/profile"
					class="block px-4 py-2 text-sm hover:bg-secondary w-full text-left transition-colors"
				>
					Profile
				</a>
				<button
					onclick={handleLogout}
					class="block px-4 py-2 text-sm text-red-500 hover:bg-secondary w-full text-left transition-colors"
				>
					Logout
				</button>
			</div>
		{/if}
	</div>

	<main class="flex-1 w-full max-w-5xl mx-auto px-4 py-8 md:py-12">
		<div class="space-y-6 md:space-y-8">
			<div class="flex items-center justify-between">
				<h2 class="text-3xl font-bold tracking-tight">Game Lobby</h2>
				<Button onclick={() => (showCreateModal = true)}>Create New Game</Button>
			</div>

			{#if error}
				<div class="p-4 bg-red-50 dark:bg-red-950 text-red-500 rounded-lg">
					{error}
				</div>
			{/if}

			{#if isLoading}
				<div class="text-center py-12 text-muted-foreground">Loading games...</div>
			{:else}
				<!-- Your Active Games -->
				{#if userGames.filter((g) => g.status === "active").length > 0}
					<div>
						<h3 class="text-xl font-semibold mb-4">Your Active Games</h3>
						<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
							{#each userGames.filter((g) => g.status === "active") as game}
								<Card.Root class="border-green-500/50">
									<div class="p-4">
										<div class="flex items-center justify-between mb-4">
											<h3 class="text-2xl font-bold leading-none">{game.name}</h3>
											<span class="text-lg text-muted-foreground">{formatTimeLeft(game.endsAt)}</span>
										</div>
										<div class="flex items-center justify-between gap-3">
											<span
												class="font-medium text-lg {game.myPnL >= 0
													? 'text-green-500'
													: 'text-red-500'}"
											>
												{game.myPnL >= 0 ? "+" : ""}${game.myPnL.toLocaleString()}
											</span>
											<Button size="sm" class="h-7 text-xs px-4" href="/game/{game._id}">Enter Game</Button>
										</div>
									</div>
								</Card.Root>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Available Games -->
				<div>
					<h3 class="text-xl font-semibold mb-4">Available Games</h3>
					<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{#each games as game}
							<Card.Root>
								<Card.Header>
									<Card.Title>{game.name}</Card.Title>
									<Card.Description>
										{#if game.status === "waiting"}
											Waiting for players • Created by {game.creatorName}
										{:else}
											<span class="inline-flex items-center gap-1.5">
												<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"
												></span>
												Live
											</span>
										{/if}
									</Card.Description>
								</Card.Header>
								<Card.Content>
									<div class="space-y-2 text-sm">
										<div class="flex justify-between">
											<span class="text-muted-foreground">Players</span>
											<span class="font-medium"
												>{game.participantCount}/{game.maxPlayers}</span
											>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">Prize Pool</span>
											<span class="font-medium text-green-500"
												>${(game.entryFee * game.participantCount).toLocaleString()}</span
											>
										</div>
										<div class="flex justify-between">
											<span class="text-muted-foreground">
												{game.status === "active" ? "Time Left" : "Duration"}
											</span>
											<span class="font-medium">
												{game.status === "active"
													? formatTimeLeft(game.endsAt)
													: formatDuration(game.durationMinutes)}
											</span>
										</div>
										<div class="mt-2">
											
										</div>
									</div>
								</Card.Content>
								<Card.Footer class="flex gap-2">
									{#if isUserInGame(game._id)}
										{#if game.status === "waiting"}
											{#if isUserCreator(game)}
												<Button
													class="flex-1"
													onclick={() => handleStartGame(game._id)}
												>
													Start Game
												</Button>
											{:else}
												<Button
													class="flex-1"
													variant="outline"
													onclick={() => handleLeaveGame(game._id)}
												>
													Leave
												</Button>
											{/if}
										{:else}
											<Button class="flex-1" href="/game/{game._id}">
												Enter Game
											</Button>
										{/if}
									{:else if game.status === "waiting" && game.participantCount < game.maxPlayers}
										<Button
											class="flex-1"
											onclick={() => handleJoinGame(game._id)}
											disabled={isJoining === game._id}
										>
											{isJoining === game._id ? "Joining..." : "Join Game"}
										</Button>
									{:else if game.status === "active"}
										<Button class="flex-1" disabled>In Progress</Button>
									{:else}
										<Button class="flex-1" disabled>Full</Button>
									{/if}
								</Card.Footer>
							</Card.Root>
						{:else}
							<Card.Root class="border-dashed col-span-full">
								<Card.Content class="py-12 text-center text-muted-foreground">
									No games available. Create one to get started!
								</Card.Content>
							</Card.Root>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</main>

	<!-- Create Game Modal -->
	{#if showCreateModal}
		<div
			class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
			onclick={() => (showCreateModal = false)}
		>
			<Card.Root
				class="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
				onclick={(e: MouseEvent) => e.stopPropagation()}
			>
				<Card.Header>
					<Card.Title>Create New Game</Card.Title>
					<Card.Description>Set up a new trading competition</Card.Description>
				</Card.Header>
				<Card.Content>
					<form
						class="space-y-4"
						onsubmit={(e: SubmitEvent) => {
							e.preventDefault();
							handleCreateGame();
						}}
					>
						<div class="space-y-2">
							<Label for="name">Game Name</Label>
							<Input
								id="name"
								placeholder="e.g., BTC vs ETH Showdown"
								bind:value={gameName}
								required
							/>
						</div>

						<div class="space-y-2">
							<Label for="description">Description (optional)</Label>
							<Input
								id="description"
								placeholder="Describe the competition..."
								bind:value={gameDescription}
							/>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="duration">Duration (minutes)</Label>
								<Input
									id="duration"
									type="number"
									min="5"
									max="1440"
									bind:value={durationMinutes}
								/>
							</div>
							<div class="space-y-2">
								<Label for="entryFee">Initial Investment / Buy-in ($)</Label>
								<Input id="entryFee" type="number" min="0" bind:value={entryFee} />
							</div>
						</div>

						<div class="space-y-2">
							<Label for="prizeDistribution">Prize Pool Split</Label>
							<select
								id="prizeDistribution"
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								bind:value={prizeDistribution}
							>
								<option value="winner-takes-all">Winner Takes All (100% to 1st)</option>
								<option value="top-3">Top 3 (50% / 30% / 20%)</option>
								<option value="top-5">Top 5 (40% / 25% / 15% / 10% / 10%)</option>
								<option value="proportional">Proportional (Based on +PnL share)</option>
							</select>
							<p class="text-[0.8rem] text-muted-foreground">
								The total prize pool is the sum of all buy-ins.
							</p>
						</div>

						<div class="flex gap-2 pt-4">
							<Button
								type="button"
								variant="outline"
								class="flex-1"
								onclick={() => (showCreateModal = false)}
							>
								Cancel
							</Button>
							<Button
								type="submit"
								class="flex-1"
								disabled={isCreating || !gameName.trim()}
							>
								{isCreating ? "Creating..." : "Create Game"}
							</Button>
						</div>
					</form>
				</Card.Content>
			</Card.Root>
		</div>
	{/if}

	<!-- How It Works Modal -->
	{#if showHowItWorks}
		<div
			class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
			onclick={() => (showHowItWorks = false)}
		>
			<Card.Root
				class="w-full max-w-3xl max-h-[90vh] overflow-y-auto"
				onclick={(e: MouseEvent) => e.stopPropagation()}
			>
				<Card.Header class="flex flex-row items-center justify-between">
					<Card.Title class="text-2xl">How It Works</Card.Title>
					<Button variant="ghost" size="sm" onclick={() => (showHowItWorks = false)}>
						✕
					</Button>
				</Card.Header>
				<Card.Content class="space-y-6">
					<div class="grid gap-6">
						<div class="border rounded-lg p-4">
							<h3 class="font-semibold text-lg mb-2">1. Join a Game</h3>
							<p class="text-muted-foreground">
								Connect your wallet and join an active trading competition. Everyone starts with the same notional capital.
							</p>
						</div>

						<div class="border rounded-lg p-4">
							<h3 class="font-semibold text-lg mb-2">2. Trade Pairs</h3>
							<p class="text-muted-foreground">
								Execute pair trades on real markets via Hyperliquid. Go long on one asset while shorting another to profit from relative price movements.
							</p>
						</div>

						<div class="border rounded-lg p-4">
							<h3 class="font-semibold text-lg mb-2">3. Win the Pool</h3>
							<p class="text-muted-foreground">
								At the end of each game, the top-performing trader wins a share of the prize pool based on their PnL.
							</p>
						</div>
					</div>
				</Card.Content>
				<Card.Footer>
					<Button class="w-full" onclick={() => (showHowItWorks = false)}>Close</Button>
				</Card.Footer>
			</Card.Root>
		</div>
	{/if}
</div>
