<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import pearPoolLogo from "$lib/assets/logo-no-bg.jpg";
	import { convex, api } from "$lib/convex";
	import { onMount, onDestroy, tick } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";

	// Hyperliquid API
	const HL_API = "https://api.hyperliquid.xyz/info";

	interface Candle {
		t: number; // open time
		T: number; // close time
		s: string; // symbol
		i: string; // interval
		o: string; // open
		c: string; // close
		h: string; // high
		l: string; // low
		v: string; // volume
		n: number; // number of trades
	}

	async function fetchCandles(coin: string, interval: string = "15m"): Promise<Candle[]> {
		// Extract base coin from formats like "BTC-PERP", "SOL-PERP", "BTC/ETH", etc.
		let baseCoin = coin;
		// Handle "BTC-PERP" format
		if (baseCoin.includes("-")) {
			baseCoin = baseCoin.split("-")[0];
		}
		// Handle "BTC/ETH" format
		if (baseCoin.includes("/")) {
			baseCoin = baseCoin.split("/")[0];
		}
		
		console.log(`Fetching candles for ${baseCoin} with interval ${interval}`);
		
		const response = await fetch(HL_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "candleSnapshot",
				req: {
					coin: baseCoin,
					interval,
					startTime: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
					endTime: Date.now(),
				},
			}),
		});
		
		if (!response.ok) {
			const errorText = await response.text();
			console.error("Hyperliquid API error:", errorText);
			throw new Error("Failed to fetch candles");
		}
		
		const data = await response.json();
		console.log(`Received ${data.length} candles`);
		return data;
	}

	// Game state
	let game = $state<any>(null);
	let leaderboard = $state<any[]>([]);
	let walletAddress = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Trading state
	let selectedPair = $state<string | null>(null);
	let tradeSize = $state(1000);
	let tradeSide = $state<"long" | "short">("long");
	let isExecutingTrade = $state(false);

	// Chart state
	let candles = $state<Candle[]>([]);
	let chartCanvas = $state<HTMLCanvasElement | null>(null);
	let isLoadingChart = $state(false);
	let chartInterval = $state<"5m" | "15m" | "1h" | "4h">("15m");
	let chartRefreshInterval: ReturnType<typeof setInterval> | undefined;

	// Timer
	let timeLeft = $state("");
	let timerInterval: ReturnType<typeof setInterval>;

	$effect(() => {
		if (game?.endsAt) {
			timerInterval = setInterval(() => {
				const now = Date.now();
				const diff = game.endsAt - now;
				if (diff <= 0) {
					timeLeft = "Game Ended";
					clearInterval(timerInterval);
				} else {
					const hours = Math.floor(diff / (1000 * 60 * 60));
					const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
					const seconds = Math.floor((diff % (1000 * 60)) / 1000);
					timeLeft = `${hours}h ${minutes}m ${seconds}s`;
				}
			}, 1000);
		}
	});

	// Load chart when pair changes and set up auto-refresh
	$effect(() => {
		if (selectedPair) {
			// Load immediately with loading indicator
			loadChart(selectedPair, chartInterval, true);
			
			// Clear any existing refresh interval
			if (chartRefreshInterval) {
				clearInterval(chartRefreshInterval);
			}
			
			// Set up auto-refresh every 5 seconds (without loading indicator)
			const currentPair = selectedPair;
			const currentInterval = chartInterval;
			chartRefreshInterval = setInterval(() => {
				// Only refresh if we're still on the same pair
				if (selectedPair === currentPair) {
					loadChart(currentPair, currentInterval, false);
				}
			}, 5000);
		}
		
		// Cleanup on effect re-run
		return () => {
			if (chartRefreshInterval) {
				clearInterval(chartRefreshInterval);
			}
		};
	});

	// Draw chart when candles or canvas changes
	$effect(() => {
		if (chartCanvas && candles.length > 0) {
			drawChart();
		}
	});

	async function loadChart(pair: string, interval: string, showLoading: boolean = true) {
		if (showLoading) isLoadingChart = true;
		try {
			const newCandles = await fetchCandles(pair, interval);
			// Only update if we're still on the same pair
			if (selectedPair === pair) {
				candles = newCandles;
				// Wait for DOM to update, then draw
				await tick();
				drawChart();
			}
		} catch (err) {
			console.error("Failed to load chart:", err);
			// Don't clear candles on error - keep existing data visible
		} finally {
			if (showLoading) isLoadingChart = false;
		}
	}

	function drawChart() {
		if (!chartCanvas || candles.length === 0) return;

		const ctx = chartCanvas.getContext("2d");
		if (!ctx) return;

		const width = chartCanvas.width;
		const height = chartCanvas.height;
		const padding = { top: 20, right: 60, bottom: 30, left: 10 };
		const chartWidth = width - padding.left - padding.right;
		const chartHeight = height - padding.top - padding.bottom;

		// Clear canvas
		ctx.fillStyle = "#0a0a0a";
		ctx.fillRect(0, 0, width, height);

		// Calculate price range
		const prices = candles.flatMap((c) => [parseFloat(c.h), parseFloat(c.l)]);
		const minPrice = Math.min(...prices);
		const maxPrice = Math.max(...prices);
		const priceRange = maxPrice - minPrice || 1;

		// Draw grid lines
		ctx.strokeStyle = "#1f1f1f";
		ctx.lineWidth = 1;
		for (let i = 0; i <= 5; i++) {
			const y = padding.top + (chartHeight / 5) * i;
			ctx.beginPath();
			ctx.moveTo(padding.left, y);
			ctx.lineTo(width - padding.right, y);
			ctx.stroke();

			// Price labels
			const price = maxPrice - (priceRange / 5) * i;
			ctx.fillStyle = "#666";
			ctx.font = "11px monospace";
			ctx.textAlign = "left";
			ctx.fillText(price.toFixed(2), width - padding.right + 5, y + 4);
		}

		// Draw candles
		const candleWidth = Math.max(2, (chartWidth / candles.length) * 0.8);
		const candleSpacing = chartWidth / candles.length;

		candles.forEach((candle, i) => {
			const x = padding.left + i * candleSpacing + candleSpacing / 2;
			const open = parseFloat(candle.o);
			const close = parseFloat(candle.c);
			const high = parseFloat(candle.h);
			const low = parseFloat(candle.l);

			const isGreen = close >= open;
			const color = isGreen ? "#22c55e" : "#ef4444";

			// Scale prices to canvas
			const scaleY = (price: number) =>
				padding.top + ((maxPrice - price) / priceRange) * chartHeight;

			// Draw wick
			ctx.strokeStyle = color;
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.moveTo(x, scaleY(high));
			ctx.lineTo(x, scaleY(low));
			ctx.stroke();

			// Draw body
			const bodyTop = scaleY(Math.max(open, close));
			const bodyBottom = scaleY(Math.min(open, close));
			const bodyHeight = Math.max(1, bodyBottom - bodyTop);

			ctx.fillStyle = color;
			ctx.fillRect(x - candleWidth / 2, bodyTop, candleWidth, bodyHeight);
		});

		// Draw current price line
		if (candles.length > 0) {
			const lastCandle = candles[candles.length - 1];
			const currentPrice = parseFloat(lastCandle.c);
			const y = padding.top + ((maxPrice - currentPrice) / priceRange) * chartHeight;

			ctx.strokeStyle = "#3b82f6";
			ctx.lineWidth = 1;
			ctx.setLineDash([5, 5]);
			ctx.beginPath();
			ctx.moveTo(padding.left, y);
			ctx.lineTo(width - padding.right, y);
			ctx.stroke();
			ctx.setLineDash([]);

			// Current price label
			ctx.fillStyle = "#3b82f6";
			ctx.fillRect(width - padding.right, y - 10, 55, 20);
			ctx.fillStyle = "#fff";
			ctx.font = "bold 11px monospace";
			ctx.fillText(currentPrice.toFixed(2), width - padding.right + 5, y + 4);
		}
	}

	let pollInterval: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		walletAddress = localStorage.getItem("walletAddress");
		if (!walletAddress) {
			goto("/");
			return;
		}
		loadGame();
		
		// Poll for updates every 5 seconds
		pollInterval = setInterval(loadGame, 5000);
		
		return () => {
			if (pollInterval) clearInterval(pollInterval);
			if (timerInterval) clearInterval(timerInterval);
		};
	});

	onDestroy(() => {
		if (pollInterval) clearInterval(pollInterval);
		if (timerInterval) clearInterval(timerInterval);
		if (chartRefreshInterval) clearInterval(chartRefreshInterval);
	});

	async function loadGame() {
		try {
			const gameId = $page.params.id;
			if (!gameId) {
				error = "Invalid game ID";
				return;
			}
			const [gameData, leaderboardData] = await Promise.all([
				convex.query(api.games.getGame, { gameId: gameId as any }),
				convex.query(api.games.getLeaderboard, { gameId: gameId as any }),
			]);
			
			if (!gameData) {
				error = "Game not found";
				return;
			}
			
			game = gameData;
			leaderboard = leaderboardData;
			
			if (!selectedPair && game.tradingPairs.length > 0) {
				selectedPair = game.tradingPairs[0];
			}
		} catch (err) {
			console.error("Failed to load game:", err);
			error = "Failed to load game";
		} finally {
			isLoading = false;
		}
	}

	async function executeTrade() {
		if (!walletAddress || !selectedPair || !game) return;
		
		isExecutingTrade = true;
		error = null;
		
		try {
			// Simulate a trade with random P&L for demo
			// In production, this would call the Pear Protocol API to execute real trades
			const simulatedPnL = (Math.random() - 0.5) * tradeSize * 0.1; // ±5% of trade size
			
			await convex.mutation(api.games.updateParticipantPnL, {
				gameId: game._id,
				walletAddress,
				pnlDelta: simulatedPnL,
			});
			
			await loadGame();
		} catch (err) {
			error = err instanceof Error ? err.message : "Trade failed";
		} finally {
			isExecutingTrade = false;
		}
	}

	function getMyPosition(): number {
		if (!walletAddress) return 0;
		const index = leaderboard.findIndex(
			(p) => p.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
		);
		return index + 1;
	}

	function getMyPnL(): number {
		if (!walletAddress) return 0;
		const participant = leaderboard.find(
			(p) => p.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
		);
		return participant?.pnl || 0;
	}

	function handleLogout() {
		localStorage.removeItem("walletAddress");
		localStorage.removeItem("token");
		goto("/");
	}

	function getRankEmoji(rank: number): string {
		if (rank === 1) return "🥇";
		if (rank === 2) return "🥈";
		if (rank === 3) return "🥉";
		return `#${rank}`;
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
				<Button variant="ghost" href="/lobby">Back to Lobby</Button>
				<Button variant="ghost" href="/profile">Profile</Button>
				<Button variant="outline" onclick={handleLogout}>Logout</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-8">
		{#if isLoading}
			<div class="text-center py-12 text-muted-foreground">Loading game...</div>
		{:else if error && !game}
			<div class="text-center py-12">
				<p class="text-red-500 mb-4">{error}</p>
				<Button href="/lobby">Back to Lobby</Button>
			</div>
		{:else if game}
			<div class="space-y-8">
				<!-- Game Header -->
				<div class="flex items-start justify-between">
					<div>
						<h2 class="text-3xl font-bold tracking-tight">{game.name}</h2>
						{#if game.description}
							<p class="text-muted-foreground mt-1">{game.description}</p>
						{/if}
					</div>
					<div class="text-right">
						<div class="text-3xl font-bold tabular-nums">{timeLeft}</div>
						<div class="text-sm text-muted-foreground">Time Remaining</div>
					</div>
				</div>

				<!-- Stats Bar -->
				<div class="grid grid-cols-4 gap-4">
					<Card.Root>
						<Card.Content class="pt-6">
							<div class="text-2xl font-bold">{getRankEmoji(getMyPosition())}</div>
							<div class="text-sm text-muted-foreground">Your Position</div>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Content class="pt-6">
							<div class="text-2xl font-bold {getMyPnL() >= 0 ? 'text-green-500' : 'text-red-500'}">
								{getMyPnL() >= 0 ? '+' : ''}${getMyPnL().toFixed(2)}
							</div>
							<div class="text-sm text-muted-foreground">Your P&L</div>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Content class="pt-6">
							<div class="text-2xl font-bold">{leaderboard.length}</div>
							<div class="text-sm text-muted-foreground">Players</div>
						</Card.Content>
					</Card.Root>
					<Card.Root>
						<Card.Content class="pt-6">
							<div class="text-2xl font-bold text-green-500">${game.prizePool.toLocaleString()}</div>
							<div class="text-sm text-muted-foreground">Prize Pool</div>
						</Card.Content>
					</Card.Root>
				</div>

				<!-- Price Chart from Hyperliquid -->
				<Card.Root>
					<Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
						<div>
							<Card.Title class="text-xl">
								{selectedPair || "Select a pair"} Chart
							</Card.Title>
							<Card.Description>Live price data from Hyperliquid</Card.Description>
						</div>
						<div class="flex gap-1">
							{#each ["5m", "15m", "1h", "4h"] as interval}
								<button
									class="px-3 py-1 text-sm rounded transition-colors {chartInterval === interval
										? 'bg-primary text-primary-foreground'
										: 'bg-muted hover:bg-muted/80'}"
									onclick={() => {
										chartInterval = interval as "5m" | "15m" | "1h" | "4h";
										if (selectedPair) loadChart(selectedPair, interval);
									}}
								>
									{interval}
								</button>
							{/each}
							<button
								class="px-3 py-1 text-sm rounded bg-muted hover:bg-muted/80 ml-2"
								onclick={() => selectedPair && loadChart(selectedPair, chartInterval)}
								disabled={isLoadingChart}
							>
								🔄
							</button>
						</div>
					</Card.Header>
					<Card.Content>
						<div class="relative w-full h-64 bg-[#0a0a0a] rounded-lg overflow-hidden">
							<canvas
								bind:this={chartCanvas}
								width="800"
								height="256"
								class="w-full h-full"
							></canvas>
							{#if isLoadingChart}
								<div class="absolute inset-0 flex items-center justify-center text-muted-foreground bg-[#0a0a0a]">
									Loading chart...
								</div>
							{:else if candles.length === 0}
								<div class="absolute inset-0 flex items-center justify-center text-muted-foreground bg-[#0a0a0a]">
									Select a trading pair to view chart
								</div>
							{/if}
						</div>
						{#if candles.length > 0}
							{@const lastCandle = candles[candles.length - 1]}
							{@const firstCandle = candles[0]}
							{@const priceChange = parseFloat(lastCandle.c) - parseFloat(firstCandle.o)}
							{@const priceChangePercent = (priceChange / parseFloat(firstCandle.o)) * 100}
							<div class="flex items-center justify-between mt-3 text-sm">
								<div class="flex gap-4">
									<span>
										O: <span class="font-mono">{parseFloat(firstCandle.o).toFixed(2)}</span>
									</span>
									<span>
										H: <span class="font-mono text-green-500">{Math.max(...candles.map(c => parseFloat(c.h))).toFixed(2)}</span>
									</span>
									<span>
										L: <span class="font-mono text-red-500">{Math.min(...candles.map(c => parseFloat(c.l))).toFixed(2)}</span>
									</span>
									<span>
										C: <span class="font-mono">{parseFloat(lastCandle.c).toFixed(2)}</span>
									</span>
								</div>
								<div class="{priceChange >= 0 ? 'text-green-500' : 'text-red-500'} font-medium">
									{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)
								</div>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<div class="grid lg:grid-cols-3 gap-8">
					<!-- Trading Panel -->
					<div class="lg:col-span-2 space-y-6">
						<Card.Root>
							<Card.Header>
								<Card.Title>Execute Trade</Card.Title>
								<Card.Description>
									Trade on {game.tradingPairs.join(", ")} via Pear Protocol
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4">
								{#if error}
									<div class="p-3 bg-red-50 dark:bg-red-950 text-red-500 rounded-md text-sm">
										{error}
									</div>
								{/if}

								<!-- Pair Selection -->
								<div class="space-y-2">
									<Label>Select Pair</Label>
									<div class="flex flex-wrap gap-2">
										{#each game.tradingPairs as pair}
											<button
												class="px-4 py-2 rounded-lg border transition-colors {selectedPair === pair
													? 'bg-primary text-primary-foreground border-primary'
													: 'bg-background hover:bg-muted'}"
												onclick={() => (selectedPair = pair)}
											>
												{pair}
											</button>
										{/each}
									</div>
								</div>

								<!-- Trade Direction -->
								<div class="space-y-2">
									<Label>Direction</Label>
									<div class="flex gap-2">
										<button
											class="flex-1 px-4 py-3 rounded-lg border transition-colors {tradeSide === 'long'
												? 'bg-green-500 text-white border-green-500'
												: 'bg-background hover:bg-muted'}"
											onclick={() => (tradeSide = "long")}
										>
											Long ↑
										</button>
										<button
											class="flex-1 px-4 py-3 rounded-lg border transition-colors {tradeSide === 'short'
												? 'bg-red-500 text-white border-red-500'
												: 'bg-background hover:bg-muted'}"
											onclick={() => (tradeSide = "short")}
										>
											Short ↓
										</button>
									</div>
								</div>

								<!-- Trade Size -->
								<div class="space-y-2">
									<Label for="size">Position Size ($)</Label>
									<Input
										id="size"
										type="number"
										min="100"
										max={game.startingCapital}
										bind:value={tradeSize}
									/>
									<div class="flex gap-2">
										{#each [0.25, 0.5, 0.75, 1] as pct}
											<button
												class="flex-1 px-2 py-1 text-sm rounded border hover:bg-muted"
												onclick={() => (tradeSize = Math.floor(game.startingCapital * pct))}
											>
												{pct * 100}%
											</button>
										{/each}
									</div>
								</div>

								<Button
									class="w-full"
									size="lg"
									onclick={executeTrade}
									disabled={isExecutingTrade || !selectedPair || game.status !== 'active'}
								>
									{#if game.status !== 'active'}
										Game Not Active
									{:else if isExecutingTrade}
										Executing...
									{:else}
										Execute {tradeSide.toUpperCase()} {selectedPair}
									{/if}
								</Button>
							</Card.Content>
						</Card.Root>
					</div>

					<!-- Leaderboard -->
					<div>
						<Card.Root>
							<Card.Header>
								<Card.Title>Leaderboard</Card.Title>
								<Card.Description>Real-time standings</Card.Description>
							</Card.Header>
							<Card.Content class="p-0">
								<div class="divide-y">
									{#each leaderboard as player, index}
										<div
											class="flex items-center justify-between p-4 {player.walletAddress?.toLowerCase() ===
											walletAddress?.toLowerCase()
												? 'bg-primary/5'
												: ''}"
										>
											<div class="flex items-center gap-3">
												<span class="text-xl w-8">{getRankEmoji(index + 1)}</span>
												<div>
													<div class="font-medium">{player.username}</div>
													<div class="text-xs text-muted-foreground">
														{player.totalTrades} trades
													</div>
												</div>
											</div>
											<span
												class="font-medium tabular-nums {player.pnl >= 0
													? 'text-green-500'
													: 'text-red-500'}"
											>
												{player.pnl >= 0 ? '+' : ''}${player.pnl.toFixed(2)}
											</span>
										</div>
									{:else}
										<div class="p-4 text-center text-muted-foreground">
											No participants yet
										</div>
									{/each}
								</div>
							</Card.Content>
						</Card.Root>
					</div>
				</div>
			</div>
		{/if}
	</main>
</div>
