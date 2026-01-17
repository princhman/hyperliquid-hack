<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import pearPoolLogo from "$lib/assets/logo-no-bg.jpg";
	import { convex, api } from "$lib/convex";
	import { onMount } from "svelte";
	import { goto } from "$app/navigation";
	import type { Id } from "../../convex/_generated/dataModel";

	// State
	let walletAddress = $state<string | null>(null);
	let games = $state<any[]>([]);
	let userGames = $state<any[]>([]);
	let isLoading = $state(true);
	let showCreateModal = $state(false);
	let isCreating = $state(false);
	let isJoining = $state<string | null>(null);
	let error = $state<string | null>(null);

	// Create game form
	let gameName = $state("");
	let gameDescription = $state("");
	let maxPlayers = $state(10);
	let startingCapital = $state(10000);
	let prizePool = $state(1000);
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
				prizePool,
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
		prizePool = 1000;
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

	function handleLogout() {
		localStorage.removeItem("walletAddress");
		localStorage.removeItem("token");
		goto("/");
	}
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-between">
			<div class="flex items-center">
				<img src={pearPoolLogo} alt="Pear Pool Logo" class="h-12 w-12 mr-3 object-contain" />
				<h1 class="text-2xl font-bold leading-none">
					<a href="/">Pear Pool</a>
				</h1>
			</div>
			<nav class="flex gap-4">
				<Button variant="ghost" href="/how-it-works">How it Works</Button>
				<Button variant="ghost" href="/lobby">Lobby</Button>
				<Button variant="ghost" href="/profile">Profile</Button>
				<Button variant="outline" onclick={handleLogout}>Logout</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="space-y-8">
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
									<Card.Header>
										<Card.Title>{game.name}</Card.Title>
										<Card.Description>
											<span class="inline-flex items-center gap-1.5">
												<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
												Live
											</span>
										</Card.Description>
									</Card.Header>
									<Card.Content>
										<div class="space-y-2 text-sm">
											<div class="flex justify-between">
												<span class="text-muted-foreground">Your P&L</span>
												<span
													class="font-medium {game.myPnL >= 0
														? 'text-green-500'
														: 'text-red-500'}"
												>
													{game.myPnL >= 0 ? "+" : ""}${game.myPnL.toLocaleString()}
												</span>
											</div>
											<div class="flex justify-between">
												<span class="text-muted-foreground">Time Left</span>
												<span class="font-medium">{formatTimeLeft(game.endsAt)}</span>
											</div>
											<div class="flex justify-between">
												<span class="text-muted-foreground">Prize Pool</span>
												<span class="font-medium text-green-500"
													>${game.prizePool.toLocaleString()}</span
												>
											</div>
										</div>
									</Card.Content>
									<Card.Footer>
										<Button class="w-full" href="/game/{game._id}">Enter Game</Button>
									</Card.Footer>
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
												>${game.prizePool.toLocaleString()}</span
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
										<div class="flex justify-between">
											<span class="text-muted-foreground">Starting Capital</span>
											<span class="font-medium"
												>${game.startingCapital.toLocaleString()}</span
											>
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
								<Label for="maxPlayers">Max Players</Label>
								<Input
									id="maxPlayers"
									type="number"
									min="2"
									max="100"
									bind:value={maxPlayers}
								/>
							</div>
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
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="capital">Starting Capital ($)</Label>
								<Input
									id="capital"
									type="number"
									min="100"
									bind:value={startingCapital}
								/>
							</div>
							<div class="space-y-2">
								<Label for="prize">Prize Pool ($)</Label>
								<Input id="prize" type="number" min="0" bind:value={prizePool} />
							</div>
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
</div>
