<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Label } from "$lib/components/ui/label";
    import * as Card from "$lib/components/ui/card";
    import { convex, api } from "$lib/convex";
    import { auth } from "$lib/stores/auth";
    import type { Id } from "../convex/_generated/dataModel";
    import type { FunctionReturnType } from "convex/server";
    import { LogOut, Plus, ArrowLeft, Trophy } from "@lucide/svelte";
    import { sendBuyIn } from "$lib/usdc";
    import { reconnect } from "@wagmi/core";
    import { config } from "$lib/wagmi";
    import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import pearPoolLogo from "$lib/assets/logo-bg-removebg-preview.png";
	import { convex, api } from "$lib/convex";
	import { onMount, onDestroy, tick } from "svelte";
	import { goto } from "$app/navigation";
	import { page } from "$app/stores";

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

	let displayedLeaderboard = $derived.by(() => {
		if (!leaderboard || leaderboard.length === 0) return [];
		
		const withRank = leaderboard.map((p, i) => ({ 
			...p, 
			rank: i + 1,
			isUser: walletAddress && p.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
		}));

		const top3 = withRank.slice(0, 3);
		
		if (!walletAddress) return top3;
		
		const userEntry = withRank.find(p => p.isUser);
		
		if (!userEntry || userEntry.rank <= 3) {
			return top3;
		}
		
		return [...top3, userEntry];
	});

	let prizePool = $derived(leaderboard.reduce((acc, p) => acc + (p.pnl || 0), 0));

	let currentBalance = $derived.by(() => {
		if (!game || !walletAddress) return 0;
		const myEntry = leaderboard.find(
			(p) => p.walletAddress?.toLowerCase() === walletAddress?.toLowerCase()
		);
		// Available Balance = Starting Capital + Realized PnL - Invested Amount
		return (game.startingCapital || 0) + (myEntry?.pnl || 0) - (myEntry?.investedAmount || 0);
	});

	let isLoading = $state(true);
	let error = $state<string | null>(null);
	let showLeaderboardModal = $state(false);

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

	function getIntervalMinutes(interval: string): number {
		if (interval === "5m") return 5;
		if (interval === "15m") return 15;
		if (interval === "1h") return 60;
		if (interval === "4h") return 240;
		return 15;
	}

	function isIntervalValid(interval: string, rangeHours: number): boolean {
		const rangeMinutes = rangeHours * 60;
		const intervalMinutes = getIntervalMinutes(interval);
		// Require at least 4 bars for a meaningful chart
		return rangeMinutes >= intervalMinutes * 4;
	}

	function handleRangeChange(hours: number) {
		chartTimeRange = hours;
		
		// Auto-adjust interval if current one is invalid
		if (!isIntervalValid(chartInterval, hours)) {
			// Find largest valid interval
			const intervals = ["5m", "15m", "1h", "4h"];
			const validIntervals = intervals.filter(i => isIntervalValid(i, hours));
			
			if (validIntervals.length > 0) {
				// Pick the largest valid interval (last one in list) to keep chart "zoomed out" properly
				// or Pick the one closest to current?
				// Simple heuristic: pick largest valid one.
				chartInterval = validIntervals[validIntervals.length - 1] as any;
			} else {
				chartInterval = "5m";
			}
		}

		if (selectedPair) loadChart(selectedPair, chartInterval);
	}

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

		// Handle High DPI scaling
		const dpr = window.devicePixelRatio || 1;
		const rect = chartCanvas.getBoundingClientRect();

		// Set actual size in memory (scaled to account for extra pixel density)
		chartCanvas.width = rect.width * dpr;
		chartCanvas.height = rect.height * dpr;

		// Normalize coordinate system to use css pixels.
		ctx.scale(dpr, dpr);

		const width = rect.width;
		const height = rect.height;
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
				investmentDelta: tradeSize,
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

	let isOwner = $derived(
		game?.creatorWalletAddress && 
		walletAddress && 
		game.creatorWalletAddress.toLowerCase() === walletAddress.toLowerCase()
	);

	async function handleDeleteGame() {
		if (!confirm("Are you sure you want to delete this game? This action cannot be undone.")) return;
		
		try {
			await convex.mutation(api.games.deleteGame, {
				gameId: game._id,
				walletAddress: walletAddress!
			});
			goto("/lobby");
		} catch (err) {
			console.error("Failed to delete game:", err);
			alert("Failed to delete game: " + (err instanceof Error ? err.message : String(err)));
		}
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
    type Lobby = FunctionReturnType<typeof api.lobby.getLobbies>[number];
    type LeaderboardEntry = FunctionReturnType<
        typeof api.lobby.getLeaderboard
    >[number];
    type AssetPosition = {
        coin: string;
        entryPrice: number;
        actualSize: number;
        leverage: number;
        marginUsed: number;
        positionValue: number;
        unrealizedPnl: number;
    };

    type Position = {
        positionId: string;
        positionValue: number;
        marginUsed: number;
        unrealizedPnl: number;
        unrealizedPnlPercentage: number;
        longAssets: AssetPosition[];
        shortAssets: AssetPosition[];
    };

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
    let newLobbyBuyIn = $state(10000);
    let newLobbyStartTime = $state("");
    let newLobbyDuration = $state(30); // minutes
    let newLobbyIsDemo = $state(true); // Default to demo mode
    let creatingLobby = $state(false);

    // Active lobby state
    let activeLobby = $state<Lobby | null>(null);
    let leaderboard = $state<LeaderboardEntry[]>([]);
    let positions = $state<Position[]>([]);
    let userCashBalance = $state(0);
    let userPositionsValue = $state(0);
    let userBalance = $state(0);
    let syncActive = $state(false);
    let refreshInterval: ReturnType<typeof setInterval> | null = null;

    // Buy form (pair trading: long one asset, short another)
    let buyLongAsset = $state("BTC");
    let buyShortAsset = $state("ETH");
    let buyLeverage = $state(1);
    let buyUsdValue = $state(100);
    let buySlippage = $state(0.01);
    let buyExecutionType = $state<"MARKET" | "SYNC" | "TWAP">("MARKET");
    let buyingPosition = $state(false);
    let closingPositionId = $state<string | null>(null);

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
        // Reconnect wagmi on page load
        await reconnect(config);

        const storedWallet = auth.setFromStorage();
        if (storedWallet) {
            await checkExistingUser(storedWallet);
        }
    });

    onDestroy(() => {
        if (refreshInterval) clearInterval(refreshInterval);
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
                isDemo: newLobbyIsDemo,
            });

            newLobbyName = "";
            newLobbyBuyIn = 10000;
            newLobbyStartTime = "";
            newLobbyDuration = 30;
            newLobbyIsDemo = true;
            showCreateLobby = false;
            await loadLobbies();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to create lobby";
        } finally {
            creatingLobby = false;
        }
    }

    async function joinLobby(lobby: Lobby) {
        if (!currentUser) return;

        joiningLobbyId = lobby._id;
        error = "";

        try {
            // Check if this is a demo lobby
            if (lobby.isDemo) {
                // Demo lobby - no payment required
                await convex.mutation(api.lobby.joinDemoLobby, {
                    userId: currentUser.id as Id<"users">,
                    lobbyId: lobby._id,
                    walletAddress: currentUser.walletAddress,
                });
            } else {
                // Real lobby - requires USDC payment
                const payment = await sendBuyIn(lobby.buyIn);
                await convex.mutation(api.lobby.joinLobby, {
                    userId: currentUser.id as Id<"users">,
                    lobbyId: lobby._id,
                    walletAddress: currentUser.walletAddress,
                    transactionId: payment.hash,
                });
            }

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

    // Derive status on frontend to avoid timezone issues
    function deriveStatus(
        startTime: number,
        endTime: number,
    ): "not started" | "started" | "finished" {
        const now = Date.now();
        if (now < startTime) return "not started";
        if (now >= endTime) return "finished";
        return "started";
    }

    async function enterLobby(lobby: Lobby) {
        activeLobby = lobby;
        await refreshActiveLobby();

        // Start refresh interval
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(refreshActiveLobby, 3000);

        // Start sync if lobby is started
        if (lobby.status === "started" && currentUser) {
            await startSync();
        }
    }

    async function refreshActiveLobby() {
        if (!activeLobby || !currentUser) return;

        // Derive current status from timestamps (frontend)
        const currentStatus = deriveStatus(
            activeLobby.startTime,
            activeLobby.endTime,
        );
        activeLobby = { ...activeLobby, status: currentStatus };

        // Check if game ended
        if (currentStatus === "finished" && positions.length > 0) {
            await endGame();
            return;
        }

        // Start sync if just started
        if (currentStatus === "started" && !syncActive) {
            await startSync();
        }

        // Load leaderboard
        leaderboard = await convex.query(api.lobby.getLeaderboard, {
            lobbyId: activeLobby._id,
        });

        // Get user balance
        const userEntry = leaderboard.find(
            (e) => e.username === currentUser?.username,
        );
        userBalance = userEntry?.totalValue ?? activeLobby.buyIn;
        userCashBalance = userEntry?.balance ?? activeLobby.buyIn;
        userPositionsValue = userEntry?.valueInPositions ?? 0;

        // Load positions
        try {
            const params = new URLSearchParams({
                lobbyId: activeLobby._id,
                address: currentUser.walletAddress,
            });
            const res = await fetch(`/api/positions?${params}`, {
                headers: {
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
            });
            if (res.ok) {
                const data = await res.json();
                positions = Array.isArray(data) ? data : [];
            }
        } catch (e) {
            console.error("Failed to load positions:", e);
        }
    }

    async function startSync() {
        if (!currentUser || syncActive) return;
        try {
            await fetch("/api/positions/sync", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    address: currentUser.walletAddress,
                    lobbyId: activeLobby?._id,
                }),
            });
            syncActive = true;
        } catch (e) {
            console.error("Failed to start sync:", e);
        }
    }

    async function buyPosition() {
        if (!currentUser || !activeLobby || buyingPosition) return;

        // Validate balance
        if (buyUsdValue > userBalance) {
            error = "Insufficient balance";
            return;
        }

        buyingPosition = true;
        error = "";

        try {
            const res = await fetch("/api/positions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                    address: currentUser.walletAddress,
                    slippage: buySlippage,
                    executionType: buyExecutionType,
                    leverage: buyLeverage,
                    usdValue: buyUsdValue,
                    longAsset: buyLongAsset,
                    shortAsset: buyShortAsset,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to open position");
            }

            await refreshActiveLobby();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to open position";
        } finally {
            buyingPosition = false;
        }
    }

    async function closePosition(positionId: string) {
        if (!currentUser || !activeLobby || closingPositionId) return;

        closingPositionId = positionId;
        error = "";

        try {
            const res = await fetch("/api/positions/close", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    positionId,
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to close position");
            }

            await refreshActiveLobby();
        } catch (e) {
            error = e instanceof Error ? e.message : "Failed to close position";
        } finally {
            closingPositionId = null;
        }
    }

    async function endGame() {
        if (!activeLobby || !currentUser) return;

        // Close all positions
        try {
            await fetch("/api/positions/close-all", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${import.meta.env.VITE_PEAR_API_TOKEN}`,
                },
                body: JSON.stringify({
                    address: currentUser.walletAddress,
                    lobbyId: activeLobby._id,
                    userId: currentUser.id,
                }),
            });
        } catch (e) {
            console.error("Failed to close all positions:", e);
        }

        // Status is derived from time, just refresh to show final state
        activeLobby = { ...activeLobby, status: "finished" };
        await refreshActiveLobby();

        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }

    function leaveLobby() {
        if (refreshInterval) {
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
        activeLobby = null;
        leaderboard = [];
        positions = [];
        loadLobbies();
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
    {:else if step === "logged-in" && currentUser && activeLobby}
        <!-- Active Lobby View -->
        <div class="mx-auto max-w-4xl space-y-6">
            <!-- Header -->
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-4">
                    <Button onclick={leaveLobby} variant="ghost" size="icon">
                        <ArrowLeft class="size-4" />
                    </Button>
                    <div>
                        <div class="flex items-center gap-2">
                            <h1 class="text-2xl font-bold">
                                {activeLobby.name}
                            </h1>
                            {#if activeLobby.isDemo}
                                <span
                                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                >
                                    DEMO
                                </span>
                            {/if}
                        </div>
                        <p class="text-sm text-muted-foreground">
                            Total: <span class="font-mono font-bold"
                                >${userBalance.toFixed(2)}</span
                            >
                            <span class="mx-1">|</span>
                            Cash:
                            <span class="font-mono"
                                >${userCashBalance.toFixed(2)}</span
                            >
                            <span class="mx-1">|</span>
                            In Trades:
                            <span class="font-mono"
                                >${userPositionsValue.toFixed(2)}</span
                            >
                            {#if activeLobby.isDemo}
                                <span class="text-purple-600 ml-1">(Paper)</span
                                >
                            {/if}
                            <span class={getStatusColor(activeLobby.status)}>
                                - {activeLobby.status}</span
                            >
                        </p>
                    </div>
                </div>
            </div>

            {#if error}
                <div
                    class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                    {error}
                </div>
            {/if}

            <!-- Buy Form (only if started) -->
            {#if activeLobby.status === "started"}
                <Card.Root>
                    <Card.Header>
                        <Card.Title>Open Pair Trade</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-4">
                        <div class="grid grid-cols-4 gap-4">
                            <div class="space-y-2">
                                <Label>Long</Label>
                                <Input
                                    bind:value={buyLongAsset}
                                    placeholder="BTC"
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Short</Label>
                                <Input
                                    bind:value={buyShortAsset}
                                    placeholder="ETH"
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>USD</Label>
                                <Input
                                    type="number"
                                    bind:value={buyUsdValue}
                                    min={0.1}
                                    max={userBalance}
                                    oninput={(e) => {
                                        const value = Number((e.target as HTMLInputElement).value);
                                        if (value < 0) buyUsdValue = 0.01;
                                    }}
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Leverage</Label>
                                <Input
                                    type="number"
                                    bind:value={buyLeverage}
                                    min={1}
                                    max={100}
                                />
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="space-y-2">
                                <Label>Slippage</Label>
                                <Input
                                    type="number"
                                    bind:value={buySlippage}
                                    min={0.001}
                                    max={0.1}
                                    step={0.001}
                                />
                            </div>
                            <div class="space-y-2">
                                <Label>Execution</Label>
                                <select
                                    bind:value={buyExecutionType}
                                    class="w-full h-10 px-3 rounded-md border bg-background"
                                >
                                    <option value="MARKET">MARKET</option>
                                    <option value="SYNC">SYNC</option>
                                    <option value="TWAP">TWAP</option>
                                </select>
                            </div>
                            <div class="flex items-end">
                                <Button
                                    onclick={buyPosition}
                                    disabled={buyingPosition ||
                                        buyUsdValue > userBalance}
                                    class="w-full"
                                >
                                    {buyingPosition
                                        ? "Opening..."
                                        : "Open Trade"}
                                </Button>
                            </div>
                        </div>
                    </Card.Content>
                </Card.Root>

                <!-- Open Positions -->
                {#if positions.length > 0}
                    <Card.Root>
                        <Card.Header>
                            <Card.Title>Your Positions</Card.Title>
                        </Card.Header>
                        <Card.Content>
                            <div class="space-y-2">
                                {#each positions as pos}
                                    {@const longAsset = pos.longAssets?.[0]}
                                    {@const shortAsset = pos.shortAssets?.[0]}
                                    {@const leverage = longAsset?.leverage ?? 1}
                                    <div
                                        class="flex items-center justify-between p-3 border rounded-md"
                                    >
                                        <div>
                                            <div class="font-bold">
                                                <span class="text-green-600"
                                                    >Long {longAsset?.coin ??
                                                        "?"}</span
                                                >
                                                <span
                                                    class="text-muted-foreground mx-1"
                                                    >/</span
                                                >
                                                <span class="text-red-600"
                                                    >Short {shortAsset?.coin ??
                                                        "?"}</span
                                                >
                                            </div>
                                            <span
                                                class="text-muted-foreground text-sm"
                                            >
                                                {leverage}x leverage
                                            </span>
                                        </div>
                                        <div class="text-right">
                                            <div class="font-mono">
                                                ${pos.marginUsed?.toFixed(2) ??
                                                    "0.00"}
                                            </div>
                                            <div
                                                class={pos.unrealizedPnl >= 0
                                                    ? "text-green-500"
                                                    : "text-red-500"}
                                            >
                                                {pos.unrealizedPnl >= 0
                                                    ? "+"
                                                    : ""}${pos.unrealizedPnl?.toFixed(
                                                    2,
                                                ) ?? "0.00"}
                                                <span class="text-xs ml-1">
                                                    ({pos.unrealizedPnlPercentage?.toFixed(
                                                        1,
                                                    ) ?? "0.0"}%)
                                                </span>
                                            </div>
                                        </div>
                                        <Button
                                            onclick={() =>
                                                closePosition(pos.positionId)}
                                            variant="outline"
                                            size="sm"
                                            disabled={closingPositionId ===
                                                pos.positionId}
                                        >
                                            {closingPositionId ===
                                            pos.positionId
                                                ? "Closing..."
                                                : "Close"}
                                        </Button>
                                    </div>
                                {/each}
                            </div>
                        </Card.Content>
                    </Card.Root>
                {/if}
            {/if}
                <!-- Trading Panel -->
				<div class="space-y-6">
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

            <!-- Leaderboard -->
            <Card.Root>
                <Card.Header>
                    <Card.Title class="flex items-center gap-2">
                        <Trophy class="size-5" />
                        {activeLobby.status === "finished"
                            ? "Final Leaderboard"
                            : "Leaderboard"}
                    </Card.Title>
                </Card.Header>
                <Card.Content>
                    <div class="space-y-2">
                        {#each leaderboard as entry}
                            <div
                                class="flex items-center justify-between p-3 border rounded-md {entry.username ===
                                currentUser.username
                                    ? 'bg-muted'
                                    : ''}"
                            >
                                <div class="flex items-center gap-3">
                                    <span class="font-bold text-lg w-8"
                                        >#{entry.rank}</span
                                    >
                                    <span>{entry.username}</span>
                                </div>
                                <div class="text-right">
                                    <div class="font-mono">
                                        ${entry.totalValue.toFixed(2)}
                                    </div>
                                    <div
                                        class={entry.pnl >= 0
                                            ? "text-green-500 text-sm"
                                            : "text-red-500 text-sm"}
                                    >
                                        {entry.pnl >= 0
                                            ? "+"
                                            : ""}{entry.pnl.toFixed(2)}
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
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
                                <Label for="buyIn"
                                    >{newLobbyIsDemo
                                        ? "Starting Balance"
                                        : "Buy-in Amount"}</Label
                                >
                                <Input
                                    id="buyIn"
                                    type="number"
                                    bind:value={newLobbyBuyIn}
                                    min={100}
                                    disabled={creatingLobby}
                                />
                            </div>
                        </div>

                        <div
                            class="flex items-center gap-3 p-3 rounded-md border bg-muted/50"
                        >
                            <input
                                id="isDemo"
                                type="checkbox"
                                bind:checked={newLobbyIsDemo}
                                disabled={creatingLobby}
                                class="h-4 w-4"
                            />
                            <div>
                                <Label for="isDemo" class="cursor-pointer"
                                    >Demo Mode (Paper Trading)</Label
                                >
                                <p class="text-xs text-muted-foreground">
                                    {newLobbyIsDemo
                                        ? "No real money required. Players get paper money to trade."
                                        : "Real USDC payment required to join."}
                                </p>
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
                                            {#if lobby.isDemo}
                                                <span
                                                    class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
                                                >
                                                    DEMO
                                                </span>
                                            {/if}
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
                                {@const isValid = isIntervalValid(interval, chartTimeRange)}
                                <button
                                    class="px-3 py-1 text-sm rounded transition-colors {chartInterval === interval
                                        ? 'bg-primary text-primary-foreground'
                                        : isValid 
                                            ? 'bg-muted hover:bg-muted/80' 
                                            : 'bg-muted/30 text-muted-foreground cursor-not-allowed'}"
                                    onclick={() => {
                                        if (!isValid) return;
                                        chartInterval = interval as "5m" | "15m" | "1h" | "4h";
                                        if (selectedPair) loadChart(selectedPair, interval);
                                    }}
                                    disabled={!isValid}
                                    title={!isValid ? `Interval too large for ${chartTimeRange}h range` : ""}
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
                                    onclick={() => handleRangeChange(option.hours)}
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
                                // Use logical coordinates (CSS pixels)
                                const x = e.clientX - rect.left;
                                const y = e.clientY - rect.top;
                                
                                const padding = { top: 20, right: 70, bottom: 30, left: 10 };
                                const chartWidth = rect.width - padding.left - padding.right;
                                const chartHeight = rect.height - padding.top - padding.bottom;
                                
                                // Check if within chart area
                                if (x >= padding.left && x <= rect.width - padding.right &&
                                    y >= padding.top && y <= rect.height - padding.bottom) {
                                    
                                    // Calculate candle/time at cursor
                                    const candleIndex = Math.floor(((x - padding.left) / chartWidth) * candles.length);
                                    const clampedIndex = Math.max(0, Math.min(candleIndex, candles.length - 1));
                                    const candle = candles[clampedIndex];
                                    const candleTime = new Date(candle.t);
                                    
                                    // Calculate chart scale
                                    const prices = candles.flatMap((c) => [parseFloat(c.h), parseFloat(c.l)]);
                                    const minPrice = Math.min(...prices);
                                    const maxPrice = Math.max(...prices);
                                    const priceRange = maxPrice - minPrice || 1;

                                    // Snap Y to Close price
                                    const closePrice = parseFloat(candle.c);
                                    const snapY = padding.top + ((maxPrice - closePrice) / priceRange) * chartHeight;
                                    
                                    // Snap to candle center
                                    const candleSpacing = chartWidth / candles.length;
                                    const snappedX = padding.left + clampedIndex * candleSpacing + candleSpacing / 2;

                                    crosshairX = (snappedX / rect.width) * 100;
                                    crosshairY = (snapY / rect.height) * 100;
                                    crosshairPrice = closePrice;
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
                                <Card.Footer>
                                    {#if lobby.status === "not started" && !lobby.hasJoined}
                                        <Button
                                            onclick={() => joinLobby(lobby)}
                                            disabled={joiningLobbyId ===
                                                lobby._id}
                                            class="w-full"
                                        >
                                            {#if joiningLobbyId === lobby._id}
                                                {lobby.isDemo
                                                    ? "Joining..."
                                                    : "Paying..."}
                                            {:else if lobby.isDemo}
                                                Join Demo (${lobby.buyIn} Paper)
                                            {:else}
                                                Join Lobby (${lobby.buyIn} USDC)
                                            {/if}
                                        </Button>
                                    {:else if lobby.hasJoined}
                                        <Button
                                            onclick={() => enterLobby(lobby)}
                                            class="w-full"
                                        >
                                            {lobby.isDemo
                                                ? "Trade (Demo)"
                                                : "Trade"}
                                        </Button>
                                    {/if}
                                </Card.Footer>
                            </Card.Root>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    {/if}
</div>
