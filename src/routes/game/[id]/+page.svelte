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

	// APIs
	const HL_API = "https://api.hyperliquid.xyz/info";
	const PEAR_API = "https://hl-v2.pearprotocol.io";

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

	interface ParsedPair {
		longs: string[];
		shorts: string[];
	}

	interface PearAsset {
		asset: string;
		weight: number;
	}

	interface PearMarket {
		key: string;
		longAssets: PearAsset[];
		shortAssets: PearAsset[];
		ratio: string;
		change24h: string;
	}

	// Parse pair key like "L:BTC,ETH|S:SOL" into components
	function parsePairKey(pairKey: string): ParsedPair {
		const parts = pairKey.split("|");
		const longPart = parts.find(p => p.startsWith("L:"));
		const shortPart = parts.find(p => p.startsWith("S:"));
		
		return {
			longs: longPart ? longPart.replace("L:", "").split(",") : [],
			shorts: shortPart ? shortPart.replace("S:", "").split(",") : []
		};
	}

	// Format pair for display
	function formatPairDisplay(pairKey: string): string {
		const { longs, shorts } = parsePairKey(pairKey);
		if (longs.length === 0 && shorts.length > 0) {
			return `📉 ${shorts.join("+")} (Short)`;
		}
		if (shorts.length === 0) {
			return `📈 ${longs.join("+")}`;
		}
		return `📈 ${longs.join("+")} / 📉 ${shorts.join("+")}`;
	}

	async function fetchSingleCoinCandles(coin: string, interval: string = "15m", hoursBack: number = 24): Promise<Candle[]> {
		// Clean coin name
		let baseCoin = coin.trim();
		if (baseCoin.includes("-")) baseCoin = baseCoin.split("-")[0];
		if (baseCoin.includes("/")) baseCoin = baseCoin.split("/")[0];
		
		const response = await fetch(HL_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				type: "candleSnapshot",
				req: {
					coin: baseCoin,
					interval,
					startTime: Date.now() - hoursBack * 60 * 60 * 1000,
					endTime: Date.now(),
				},
			}),
		});
		
		if (!response.ok) throw new Error(`Failed to fetch ${baseCoin}`);
		return await response.json();
	}

	// Fetch and calculate ratio candles for pairs
	async function fetchPairCandles(pairKey: string, interval: string = "15m", hoursBack: number = 24): Promise<Candle[]> {
		const { longs, shorts } = parsePairKey(pairKey);
		
		if (longs.length === 0 && shorts.length === 0) {
			throw new Error("No assets in pair");
		}

		// If only shorts (no longs), return the first short's candles
		if (longs.length === 0 && shorts.length > 0) {
			return await fetchSingleCoinCandles(shorts[0], interval, hoursBack);
		}

		// If no shorts, just return the first long's candles
		if (shorts.length === 0) {
			return await fetchSingleCoinCandles(longs[0], interval, hoursBack);
		}

		// Fetch candles for all assets in parallel
		const allCoins = [...longs, ...shorts];
		const allCandlesArrays = await Promise.all(
			allCoins.map(coin => fetchSingleCoinCandles(coin, interval, hoursBack))
		);

		// Create a map of coin -> candles indexed by timestamp
		const candlesByTime: Map<number, Map<string, Candle>> = new Map();
		
		allCandlesArrays.forEach((candleArray, idx) => {
			const coin = allCoins[idx];
			candleArray.forEach(candle => {
				if (!candlesByTime.has(candle.t)) {
					candlesByTime.set(candle.t, new Map());
				}
				candlesByTime.get(candle.t)!.set(coin, candle);
			});
		});

		// Calculate ratio candles (sum of longs / sum of shorts)
		const ratioCandles: Candle[] = [];
		
		const sortedTimes = Array.from(candlesByTime.keys()).sort((a, b) => a - b);
		
		for (const time of sortedTimes) {
			const coinsAtTime = candlesByTime.get(time)!;
			
			// Check if we have all coins for this timestamp
			const hasAllCoins = allCoins.every(coin => coinsAtTime.has(coin));
			if (!hasAllCoins) continue;

			// Calculate weighted sum for longs and shorts
			let longOpen = 0, longClose = 0, longHigh = 0, longLow = 0;
			let shortOpen = 0, shortClose = 0, shortHigh = 0, shortLow = 0;

			for (const coin of longs) {
				const c = coinsAtTime.get(coin)!;
				longOpen += parseFloat(c.o);
				longClose += parseFloat(c.c);
				longHigh += parseFloat(c.h);
				longLow += parseFloat(c.l);
			}

			for (const coin of shorts) {
				const c = coinsAtTime.get(coin)!;
				shortOpen += parseFloat(c.o);
				shortClose += parseFloat(c.c);
				shortHigh += parseFloat(c.h);
				shortLow += parseFloat(c.l);
			}

			// Calculate ratio (long / short)
			const firstCandle = coinsAtTime.get(longs[0])!;
			ratioCandles.push({
				t: time,
				T: firstCandle.T,
				s: `${longs.join("+")}/${shorts.join("+")}`,
				i: firstCandle.i,
				o: (longOpen / shortOpen).toFixed(6),
				c: (longClose / shortClose).toFixed(6),
				h: (longHigh / shortLow).toFixed(6), // Max ratio
				l: (longLow / shortHigh).toFixed(6), // Min ratio
				v: "0",
				n: 0
			});
		}

		return ratioCandles;
	}

	// Game state
	let game = $state<any>(null);
	let leaderboard = $state<any[]>([]);
	let walletAddress = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	// Available coins from Pear Protocol
	let availableCoins = $state<string[]>([]);
	let isLoadingCoins = $state(false);
	
	// Long/Short pair selection
	let selectedLongs = $state<string[]>([]);
	let selectedShorts = $state<string[]>([]);
	let longSearchInput = $state("");
	let shortSearchInput = $state("");
	let showLongDropdown = $state(false);
	let showShortDropdown = $state(false);

	// Trading state
	let selectedPair = $state<string | null>(null);
	let tradeSize = $state(1000);
	let isExecutingTrade = $state(false);

	// Build pair key in Pear format from selected longs and shorts
	let pairKey = $derived(() => {
		if (selectedLongs.length === 0 && selectedShorts.length === 0) return "";
		
		const parts: string[] = [];
		if (selectedLongs.length > 0) {
			parts.push(`L:${selectedLongs.join(",")}`);
		}
		if (selectedShorts.length > 0) {
			parts.push(`S:${selectedShorts.join(",")}`);
		}
		return parts.join("|");
	});

	// Filtered coins based on search for longs
	let filteredLongCoins = $derived(
		longSearchInput.trim() 
			? availableCoins
				.filter(coin => 
					coin.toUpperCase().includes(longSearchInput.toUpperCase()) && 
					!selectedLongs.includes(coin)
				)
				.slice(0, 10)
			: []
	);

	// Filtered coins based on search for shorts
	let filteredShortCoins = $derived(
		shortSearchInput.trim() 
			? availableCoins
				.filter(coin => 
					coin.toUpperCase().includes(shortSearchInput.toUpperCase()) && 
					!selectedShorts.includes(coin)
				)
				.slice(0, 10)
			: []
	);

	// Chart state
	let candles = $state<Candle[]>([]);
	let chartCanvas = $state<HTMLCanvasElement | null>(null);
	let isLoadingChart = $state(false);
	let chartInterval = $state<"5m" | "15m" | "1h" | "4h">("15m");
	let chartRefreshInterval: ReturnType<typeof setInterval> | undefined;
	let chartError = $state<string | null>(null);
	
	// Zoom / Time range state (in hours)
	let chartTimeRange = $state<number>(24); // Default 24 hours
	const timeRangeOptions = [
		{ label: "1H", hours: 1 },
		{ label: "4H", hours: 4 },
		{ label: "12H", hours: 12 },
		{ label: "1D", hours: 24 },
		{ label: "3D", hours: 72 },
		{ label: "1W", hours: 168 },
	];

	// Crosshair state for mouse tracking
	let crosshairX = $state<number | null>(null);
	let crosshairY = $state<number | null>(null);
	let crosshairPrice = $state<number | null>(null);
	let crosshairTime = $state<string | null>(null);

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
			const newCandles = await fetchPairCandles(pair, interval, chartTimeRange);
			// Only update if we're still on the same pair
			if (selectedPair === pair) {
				candles = newCandles;
				chartError = null; // Clear any previous error
				// Wait for DOM to update, then draw
				await tick();
				drawChart();
			}
		} catch (err) {
			console.error("Failed to load chart:", err);
			if (selectedPair === pair) {
				chartError = `Failed to fetch ${formatPairDisplay(pair)} data. Trading is paused.`;
				// Clear the refresh interval on error
				if (chartRefreshInterval) {
					clearInterval(chartRefreshInterval);
					chartRefreshInterval = undefined;
				}
			}
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
		const padding = { top: 20, right: 70, bottom: 30, left: 10 };
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

		// Determine decimal places based on price magnitude
		const avgPrice = (maxPrice + minPrice) / 2;
		const decimals = avgPrice < 1 ? 6 : avgPrice < 10 ? 4 : avgPrice < 100 ? 3 : 2;

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
			ctx.font = "10px monospace";
			ctx.textAlign = "left";
			ctx.fillText(price.toFixed(decimals), width - padding.right + 5, y + 4);
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
			ctx.fillRect(width - padding.right, y - 10, 65, 20);
			ctx.fillStyle = "#fff";
			ctx.font = "bold 10px monospace";
			ctx.fillText(currentPrice.toFixed(decimals), width - padding.right + 3, y + 4);
		}
	}

	let pollInterval: ReturnType<typeof setInterval> | undefined;

	onMount(() => {
		walletAddress = localStorage.getItem("walletAddress");
		if (!walletAddress) {
			goto("/");
			return;
		}
		// Load game and available coins in parallel
		Promise.all([loadGame(), fetchAvailableCoins()]);
		
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
			
			// Players choose their own pairs - update if they have selections
			if (!selectedPair && (selectedLongs.length > 0 || selectedShorts.length > 0)) {
				selectedPair = pairKey();
			}
		} catch (err) {
			console.error("Failed to load game:", err);
			error = "Failed to load game";
		} finally {
			isLoading = false;
		}
	}

	async function fetchAvailableCoins() {
		isLoadingCoins = true;
		try {
			const response = await fetch(`${PEAR_API}/markets/active`);
			if (!response.ok) throw new Error("Failed to fetch from Pear");
			const data = await response.json();
			
			const assetSet = new Set<string>();
			const allMarkets = [
				...(data.active || []),
				...(data.topGainers || []),
				...(data.topLosers || []),
			];
			
			allMarkets.forEach((market: PearMarket) => {
				market.longAssets?.forEach((a: PearAsset) => {
					if (!a.asset.includes(":")) {
						assetSet.add(a.asset);
					}
				});
				market.shortAssets?.forEach((a: PearAsset) => {
					if (!a.asset.includes(":")) {
						assetSet.add(a.asset);
					}
				});
			});
			
			availableCoins = Array.from(assetSet).sort();
			console.log(`Loaded ${availableCoins.length} available coins from Pear Protocol`);
		} catch (err) {
			console.error("Failed to fetch from Pear Protocol:", err);
			availableCoins = [
				"BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "HYPE", "LINK",
				"DOGE", "XRP", "ADA", "DOT", "ATOM", "UNI", "APT", "SUI"
			];
		} finally {
			isLoadingCoins = false;
		}
	}

	function selectLong(coin: string) {
		if (!selectedLongs.includes(coin)) {
			selectedLongs = [...selectedLongs, coin];
		}
		longSearchInput = "";
		showLongDropdown = false;
		// Update selected pair for chart
		updateSelectedPair();
	}

	function removeLong(coin: string) {
		selectedLongs = selectedLongs.filter((c) => c !== coin);
		updateSelectedPair();
	}

	function selectShort(coin: string) {
		if (!selectedShorts.includes(coin)) {
			selectedShorts = [...selectedShorts, coin];
		}
		shortSearchInput = "";
		showShortDropdown = false;
		// Update selected pair for chart
		updateSelectedPair();
	}

	function removeShort(coin: string) {
		selectedShorts = selectedShorts.filter((c) => c !== coin);
		updateSelectedPair();
	}

	function updateSelectedPair() {
		const key = pairKey();
		if (key) {
			selectedPair = key;
		} else {
			selectedPair = null;
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
				<div class="grid grid-cols-4 gap-4 justify-center">
					
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
								{selectedPair ? formatPairDisplay(selectedPair) : "Select a pair"} Chart
							</Card.Title>
							<Card.Description>
								{#if selectedPair}
									{@const parsed = parsePairKey(selectedPair)}
									{#if parsed.shorts.length > 0}
										Ratio chart: {parsed.longs.join("+")} / {parsed.shorts.join("+")}
									{:else}
										Price chart from Hyperliquid
									{/if}
								{:else}
									Select a pair to view chart
								{/if}
							</Card.Description>
						</div>
						<div class="flex flex-col gap-2 items-end">
							<!-- Candle Interval -->
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
							<!-- Zoom / Time Range -->
							<div class="flex gap-1 items-center">
								<span class="text-xs text-muted-foreground mr-1">Range:</span>
								{#each timeRangeOptions as option}
									<button
										class="px-2 py-0.5 text-xs rounded transition-colors {chartTimeRange === option.hours
											? 'bg-blue-500 text-white'
											: 'bg-muted hover:bg-muted/80'}"
										onclick={() => {
											chartTimeRange = option.hours;
											if (selectedPair) loadChart(selectedPair, chartInterval);
										}}
									>
										{option.label}
									</button>
								{/each}
							</div>
						</div>
					</Card.Header>
					<Card.Content>
						<div class="relative w-full h-64 bg-[#0a0a0a] rounded-lg overflow-hidden">
							<canvas
								bind:this={chartCanvas}
								width="800"
								height="256"
								class="w-full h-full cursor-crosshair"
								onmousemove={(e) => {
									if (!chartCanvas || candles.length === 0) return;
									const rect = chartCanvas.getBoundingClientRect();
									const scaleX = chartCanvas.width / rect.width;
									const scaleY = chartCanvas.height / rect.height;
									const x = (e.clientX - rect.left) * scaleX;
									const y = (e.clientY - rect.top) * scaleY;
									
									const padding = { top: 20, right: 70, bottom: 30, left: 10 };
									const chartWidth = chartCanvas.width - padding.left - padding.right;
									const chartHeight = chartCanvas.height - padding.top - padding.bottom;
									
									// Check if within chart area
									if (x >= padding.left && x <= chartCanvas.width - padding.right &&
									    y >= padding.top && y <= chartCanvas.height - padding.bottom) {
										
										// Calculate price at cursor
										const prices = candles.flatMap((c) => [parseFloat(c.h), parseFloat(c.l)]);
										const minPrice = Math.min(...prices);
										const maxPrice = Math.max(...prices);
										const priceRange = maxPrice - minPrice || 1;
										const priceAtY = maxPrice - ((y - padding.top) / chartHeight) * priceRange;
										
										// Calculate candle/time at cursor
										const candleIndex = Math.floor(((x - padding.left) / chartWidth) * candles.length);
										const clampedIndex = Math.max(0, Math.min(candleIndex, candles.length - 1));
										const candleTime = new Date(candles[clampedIndex].t);
										
										crosshairX = (x / chartCanvas.width) * 100;
										crosshairY = (y / chartCanvas.height) * 100;
										crosshairPrice = priceAtY;
										crosshairTime = candleTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
									} else {
										crosshairX = null;
										crosshairY = null;
										crosshairPrice = null;
										crosshairTime = null;
									}
								}}
								onmouseleave={() => {
									crosshairX = null;
									crosshairY = null;
									crosshairPrice = null;
									crosshairTime = null;
								}}
							></canvas>
							
							<!-- Crosshair overlay -->
							{#if crosshairX !== null && crosshairY !== null}
								<!-- Vertical line -->
								<div 
									class="absolute top-0 bottom-0 w-px bg-blue-500/70 pointer-events-none"
									style="left: {crosshairX}%"
								></div>
								<!-- Horizontal line -->
								<div 
									class="absolute left-0 right-0 h-px bg-blue-500/70 pointer-events-none"
									style="top: {crosshairY}%"
								></div>
								<!-- Price label on Y axis -->
								<div 
									class="absolute right-0 bg-blue-500 text-white text-xs font-mono px-1 py-0.5 rounded-l pointer-events-none"
									style="top: {crosshairY}%; transform: translateY(-50%)"
								>
									{crosshairPrice !== null ? (crosshairPrice < 1 ? crosshairPrice.toFixed(6) : crosshairPrice < 10 ? crosshairPrice.toFixed(4) : crosshairPrice < 100 ? crosshairPrice.toFixed(3) : crosshairPrice.toFixed(2)) : ''}
								</div>
								<!-- Time label on X axis -->
								<div 
									class="absolute bottom-0 bg-blue-500 text-white text-xs font-mono px-1 py-0.5 rounded-t pointer-events-none"
									style="left: {crosshairX}%; transform: translateX(-50%)"
								>
									{crosshairTime}
								</div>
							{/if}
							{#if chartError}
								<div class="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 text-red-400 p-4">
									<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
									</svg>
									<p class="text-center font-medium">{chartError}</p>
									<button
										class="mt-3 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
										onclick={() => {
											chartError = null;
											if (selectedPair) loadChart(selectedPair, chartInterval, true);
										}}
									>
										Retry Connection
									</button>
								</div>
							{:else if isLoadingChart}
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
							{@const firstTime = new Date(firstCandle.t)}
							{@const lastTime = new Date(lastCandle.T)}
							{@const hoursAgo = Math.round((Date.now() - firstCandle.t) / (1000 * 60 * 60))}
							{@const avgPrice = (parseFloat(lastCandle.h) + parseFloat(lastCandle.l)) / 2}
							{@const dec = avgPrice < 1 ? 6 : avgPrice < 10 ? 4 : avgPrice < 100 ? 3 : 2}
							<div class="flex items-center justify-between mt-3 text-sm">
								<div class="flex gap-4">
									<span>
										O: <span class="font-mono">{parseFloat(firstCandle.o).toFixed(dec)}</span>
									</span>
									<span>
										H: <span class="font-mono text-green-500">{Math.max(...candles.map(c => parseFloat(c.h))).toFixed(dec)}</span>
									</span>
									<span>
										L: <span class="font-mono text-red-500">{Math.min(...candles.map(c => parseFloat(c.l))).toFixed(dec)}</span>
									</span>
									<span>
										C: <span class="font-mono">{parseFloat(lastCandle.c).toFixed(dec)}</span>
									</span>
								</div>
								<div class="{priceChange >= 0 ? 'text-green-500' : 'text-red-500'} font-medium">
									{priceChange >= 0 ? '+' : ''}{priceChange.toFixed(dec)} ({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)
								</div>
							</div>
							<div class="flex items-center justify-between mt-2 text-xs text-muted-foreground">
								<span>
									📅 From: {firstTime.toLocaleDateString()} {firstTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
									→ {lastTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
								</span>
								<span>
									{candles.length} candles • ~{hoursAgo}h lookback
								</span>
							</div>
						{/if}
					</Card.Content>
				</Card.Root>

				<div class="grid lg:grid-cols-3 gap-8">
					<!-- Trading Panel -->
					<div class="lg:col-span-2 space-y-6">
						<Card.Root>
							<Card.Header>
								<Card.Title>Build Your Trade</Card.Title>
								<Card.Description>
									Create a pair by selecting Long (bullish) and/or Short (bearish) assets
								</Card.Description>
							</Card.Header>
							<Card.Content class="space-y-4">
								{#if error}
									<div class="p-3 bg-red-50 dark:bg-red-950 text-red-500 rounded-md text-sm">
										{error}
									</div>
								{/if}

								<!-- LONG Selection -->
								<div class="space-y-2 p-3 border border-green-500/30 rounded-lg bg-green-500/5">
									<Label class="text-green-500 flex items-center gap-1">
										📈 Long (Bullish)
										<span class="text-xs text-muted-foreground font-normal">- Assets you expect to go up</span>
									</Label>
									
									<!-- Selected longs -->
									<div class="flex flex-wrap gap-2 min-h-[36px]">
										{#if selectedLongs.length === 0}
											<span class="text-muted-foreground text-sm">Select asset(s) you're bullish on</span>
										{/if}
										{#each selectedLongs as coin}
											<span class="inline-flex items-center gap-1 px-2 py-1 text-sm bg-green-500 text-white rounded-full">
												{coin}
												<button
													type="button"
													class="hover:bg-white/20 rounded-full p-0.5"
													onclick={() => removeLong(coin)}
													aria-label="Remove {coin}"
												>
													<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
													</svg>
												</button>
											</span>
										{/each}
									</div>

									<!-- Long search -->
									<div class="relative">
										<Input
											placeholder={isLoadingCoins ? "Loading..." : "Search (e.g., BTC, ETH...)"}
											bind:value={longSearchInput}
											onfocus={() => (showLongDropdown = true)}
											onblur={() => setTimeout(() => (showLongDropdown = false), 200)}
											disabled={isLoadingCoins}
											class="border-green-500/30"
										/>
										{#if showLongDropdown && filteredLongCoins.length > 0}
											<div class="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
												{#each filteredLongCoins as coin}
													<button
														type="button"
														class="w-full px-3 py-2 text-left hover:bg-green-500/10 transition-colors"
														onmousedown={() => selectLong(coin)}
													>
														<span class="font-medium">{coin}</span>
													</button>
												{/each}
											</div>
										{/if}
									</div>

									<!-- Quick picks -->
									<div class="flex flex-wrap gap-1">
										{#each availableCoins.filter(c => !selectedLongs.includes(c)).slice(0, 10) as coin}
											<button
												type="button"
												class="px-2 py-0.5 text-xs rounded border border-green-500/30 hover:bg-green-500/20 transition-colors"
												onclick={() => selectLong(coin)}
											>
												+ {coin}
											</button>
										{/each}
									</div>
								</div>

								<!-- SHORT Selection -->
								<div class="space-y-2 p-3 border border-red-500/30 rounded-lg bg-red-500/5">
									<Label class="text-red-500 flex items-center gap-1">
										📉 Short (Bearish)
										<span class="text-xs text-muted-foreground font-normal">- Assets you expect to go down</span>
									</Label>
									
									<!-- Selected shorts -->
									<div class="flex flex-wrap gap-2 min-h-[36px]">
										{#if selectedShorts.length === 0}
											<span class="text-muted-foreground text-sm">Select asset(s) you're bearish on</span>
										{/if}
										{#each selectedShorts as coin}
											<span class="inline-flex items-center gap-1 px-2 py-1 text-sm bg-red-500 text-white rounded-full">
												{coin}
												<button
													type="button"
													class="hover:bg-white/20 rounded-full p-0.5"
													onclick={() => removeShort(coin)}
													aria-label="Remove {coin}"
												>
													<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
													</svg>
												</button>
											</span>
										{/each}
									</div>

									<!-- Short search -->
									<div class="relative">
										<Input
											placeholder={isLoadingCoins ? "Loading..." : "Search (e.g., SOL, DOGE...)"}
											bind:value={shortSearchInput}
											onfocus={() => (showShortDropdown = true)}
											onblur={() => setTimeout(() => (showShortDropdown = false), 200)}
											disabled={isLoadingCoins}
											class="border-red-500/30"
										/>
										{#if showShortDropdown && filteredShortCoins.length > 0}
											<div class="absolute z-10 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-40 overflow-y-auto">
												{#each filteredShortCoins as coin}
													<button
														type="button"
														class="w-full px-3 py-2 text-left hover:bg-red-500/10 transition-colors"
														onmousedown={() => selectShort(coin)}
													>
														<span class="font-medium">{coin}</span>
													</button>
												{/each}
											</div>
										{/if}
									</div>

									<!-- Quick picks -->
									<div class="flex flex-wrap gap-1">
										{#each availableCoins.filter(c => !selectedShorts.includes(c) && !selectedLongs.includes(c)).slice(0, 10) as coin}
											<button
												type="button"
												class="px-2 py-0.5 text-xs rounded border border-red-500/30 hover:bg-red-500/20 transition-colors"
												onclick={() => selectShort(coin)}
											>
												+ {coin}
											</button>
										{/each}
									</div>
								</div>

								<!-- Pair Preview -->
								{#if selectedLongs.length > 0 || selectedShorts.length > 0}
									<div class="p-3 bg-muted/50 rounded-lg">
										<p class="text-sm font-medium">Your Pair:</p>
										<p class="text-lg font-bold mt-1">{formatPairDisplay(pairKey())}</p>
										<p class="text-xs text-muted-foreground mt-1">
											{#if selectedLongs.length > 0 && selectedShorts.length > 0}
												Chart shows ratio: {selectedLongs.join("+")} / {selectedShorts.join("+")}
											{:else if selectedLongs.length > 0}
												Chart shows {selectedLongs.join("+")} price
											{:else}
												Chart shows {selectedShorts.join("+")} price (inverted for short)
											{/if}
										</p>
									</div>
								{/if}

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
									disabled={isExecutingTrade || (selectedLongs.length === 0 && selectedShorts.length === 0) || game.status !== 'active' || !!chartError}
								>
									{#if chartError}
										Trading Paused - API Error
									{:else if game.status !== 'active'}
										Game Not Active
									{:else if selectedLongs.length === 0 && selectedShorts.length === 0}
										Select Long or Short Assets
									{:else if isExecutingTrade}
										Executing Trade...
									{:else}
										Execute Trade: {formatPairDisplay(pairKey())}
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
