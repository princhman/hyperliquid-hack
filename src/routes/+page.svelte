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
    import { Search, X, TrendingUp, TrendingDown, RefreshCw } from "@lucide/svelte";

    const HL_API = "https://api.hyperliquid.xyz/info";
    const PEAR_API = "https://hl-v2.pearprotocol.io";

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
    interface Candle {
        t: number;
        T: number;
        s: string;
        i: string;
        o: string;
        c: string;
        h: string;
        l: string;
        v: string;
        n: number;
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

    // ============ STATE ============
    // Available coins from Pear Protocol
    let availableCoins = $state<string[]>([]);
    let isLoadingCoins = $state(false);

    // Pear markets for pre-built pairs
    let pearMarkets = $state<PearMarket[]>([]);
    let topGainers = $state<PearMarket[]>([]);
    let topLosers = $state<PearMarket[]>([]);
    let isLoadingMarkets = $state(false);

    // Long/Short pair selection
    let selectedLongs = $state<string[]>([]);
    let selectedShorts = $state<string[]>([]);
    let longSearchInput = $state("");
    let shortSearchInput = $state("");
    let showLongDropdown = $state(false);
    let showShortDropdown = $state(false);

    // Global pair search
    let pairSearchInput = $state("");
    let showPairSearchResults = $state(false);

    // Chart state
    let candles = $state<Candle[]>([]);
    let chartCanvas = $state<HTMLCanvasElement | null>(null);
    let isLoadingChart = $state(false);
    let chartInterval = $state<"5m" | "15m" | "1h" | "4h">("15m");
    let chartRefreshInterval: ReturnType<typeof setInterval> | undefined;
    let chartError = $state<string | null>(null);
    let chartTimeRange = $state<number>(24);

    const timeRangeOptions = [
        { label: "1H", hours: 1 },
        { label: "4H", hours: 4 },
        { label: "12H", hours: 12 },
        { label: "1D", hours: 24 },
        { label: "3D", hours: 72 },
        { label: "1W", hours: 168 },
    ];

    // Crosshair state
    let crosshairX = $state<number | null>(null);
    let crosshairY = $state<number | null>(null);
    let crosshairPrice = $state<number | null>(null);
    let crosshairTime = $state<string | null>(null);

    // ============ DERIVED STATE ============
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

    // Filter Pear markets based on search
    let filteredPearMarkets = $derived(() => {
        if (!pairSearchInput.trim()) return [];
        const search = pairSearchInput.toUpperCase();
        return pearMarkets
            .filter(market => {
                const longStr = market.longAssets.map(a => a.asset).join("+");
                const shortStr = market.shortAssets.map(a => a.asset).join("+");
                return longStr.includes(search) || shortStr.includes(search) || market.key.toUpperCase().includes(search);
            })
            .slice(0, 10);
    });

    // ============ HELPER FUNCTIONS ============
    function parsePairKey(pairKeyStr: string): { longs: string[]; shorts: string[] } {
        const parts = pairKeyStr.split("|");
        const longPart = parts.find(p => p.startsWith("L:"));
        const shortPart = parts.find(p => p.startsWith("S:"));
        
        return {
            longs: longPart ? longPart.replace("L:", "").split(",") : [],
            shorts: shortPart ? shortPart.replace("S:", "").split(",") : []
        };
    }

    function formatPairDisplay(pairKeyStr: string): string {
        const { longs, shorts } = parsePairKey(pairKeyStr);
        if (longs.length === 0 && shorts.length > 0) {
            return `📉 ${shorts.join(" + ")} (Short)`;
        }
        if (shorts.length === 0 && longs.length > 0) {
            return `📈 ${longs.join(" + ")}`;
        }
        if (longs.length > 0 && shorts.length > 0) {
            return `📈 ${longs.join(" + ")} / 📉 ${shorts.join(" + ")}`;
        }
        return "Select assets";
    }

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
        return rangeMinutes >= intervalMinutes * 4;
    }

    function formatMarketDisplay(market: PearMarket): string {
        const longs = market.longAssets.map(a => a.asset).join("+");
        const shorts = market.shortAssets.map(a => a.asset).join("+");
        return `${longs} / ${shorts}`;
    }

    // ============ API FUNCTIONS ============
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
        } catch (err) {
            console.error("Failed to fetch from Pear Protocol:", err);
            // Fallback coins
            availableCoins = [
                "BTC", "ETH", "SOL", "AVAX", "ARB", "OP", "HYPE", "LINK",
                "DOGE", "XRP", "ADA", "DOT", "ATOM", "UNI", "APT", "SUI",
                "MATIC", "FTM", "NEAR", "INJ", "SEI", "TIA", "JUP", "WIF"
            ];
        } finally {
            isLoadingCoins = false;
        }
    }

    async function fetchPearMarkets() {
        isLoadingMarkets = true;
        try {
            const response = await fetch(`${PEAR_API}/markets/active`);
            if (!response.ok) throw new Error("Failed to fetch markets");
            const data = await response.json();
            
            pearMarkets = data.active || [];
            topGainers = (data.topGainers || []).slice(0, 5);
            topLosers = (data.topLosers || []).slice(0, 5);
        } catch (err) {
            console.error("Failed to fetch Pear markets:", err);
        } finally {
            isLoadingMarkets = false;
        }
    }

    async function fetchSingleCoinCandles(coin: string, interval: string = "15m", hoursBack: number = 24): Promise<Candle[]> {
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

    async function fetchPairCandles(pairKeyStr: string, interval: string = "15m", hoursBack: number = 24): Promise<Candle[]> {
        const { longs, shorts } = parsePairKey(pairKeyStr);
        
        if (longs.length === 0 && shorts.length === 0) {
            throw new Error("No assets selected");
        }

        // Only longs - just show price
        if (shorts.length === 0 && longs.length > 0) {
            if (longs.length === 1) {
                return await fetchSingleCoinCandles(longs[0], interval, hoursBack);
            }
            // Multiple longs - show combined/average
            const allCandlesArrays = await Promise.all(
                longs.map(coin => fetchSingleCoinCandles(coin, interval, hoursBack))
            );
            return combineCandles(longs, [], allCandlesArrays, interval);
        }

        // Only shorts - show inverted (1/price)
        if (longs.length === 0 && shorts.length > 0) {
            if (shorts.length === 1) {
                const candles = await fetchSingleCoinCandles(shorts[0], interval, hoursBack);
                // Invert the candles for short view
                return candles.map(c => ({
                    ...c,
                    o: (1 / parseFloat(c.o)).toFixed(8),
                    c: (1 / parseFloat(c.c)).toFixed(8),
                    h: (1 / parseFloat(c.l)).toFixed(8), // High becomes inverted low
                    l: (1 / parseFloat(c.h)).toFixed(8), // Low becomes inverted high
                }));
            }
            const allCandlesArrays = await Promise.all(
                shorts.map(coin => fetchSingleCoinCandles(coin, interval, hoursBack))
            );
            return combineCandles([], shorts, allCandlesArrays, interval);
        }

        // Both longs and shorts - show ratio
        const allCoins = [...longs, ...shorts];
        const allCandlesArrays = await Promise.all(
            allCoins.map(coin => fetchSingleCoinCandles(coin, interval, hoursBack))
        );
        
        return combineCandles(longs, shorts, allCandlesArrays, interval);
    }

    function combineCandles(longs: string[], shorts: string[], allCandlesArrays: Candle[][], interval: string): Candle[] {
        const allCoins = [...longs, ...shorts];
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

        const ratioCandles: Candle[] = [];
        const sortedTimes = Array.from(candlesByTime.keys()).sort((a, b) => a - b);
        
        for (const time of sortedTimes) {
            const coinsAtTime = candlesByTime.get(time)!;
            const hasAllCoins = allCoins.every(coin => coinsAtTime.has(coin));
            if (!hasAllCoins) continue;

            let longOpen = 0, longClose = 0, longHigh = 0, longLow = 0;
            let shortOpen = 0, shortClose = 0, shortHigh = 0, shortLow = 0;

            // Sum up long prices
            for (const coin of longs) {
                const c = coinsAtTime.get(coin)!;
                longOpen += parseFloat(c.o);
                longClose += parseFloat(c.c);
                longHigh += parseFloat(c.h);
                longLow += parseFloat(c.l);
            }

            // Sum up short prices
            for (const coin of shorts) {
                const c = coinsAtTime.get(coin)!;
                shortOpen += parseFloat(c.o);
                shortClose += parseFloat(c.c);
                shortHigh += parseFloat(c.h);
                shortLow += parseFloat(c.l);
            }

            const firstCandle = coinsAtTime.get(allCoins[0])!;

            // If only longs, show sum
            if (shorts.length === 0) {
                ratioCandles.push({
                    t: time,
                    T: firstCandle.T,
                    s: longs.join("+"),
                    i: interval,
                    o: longOpen.toFixed(6),
                    c: longClose.toFixed(6),
                    h: longHigh.toFixed(6),
                    l: longLow.toFixed(6),
                    v: "0",
                    n: 0
                });
            }
            // If only shorts, show inverted sum
            else if (longs.length === 0) {
                ratioCandles.push({
                    t: time,
                    T: firstCandle.T,
                    s: shorts.join("+") + " (inv)",
                    i: interval,
                    o: (1 / shortOpen).toFixed(8),
                    c: (1 / shortClose).toFixed(8),
                    h: (1 / shortLow).toFixed(8),
                    l: (1 / shortHigh).toFixed(8),
                    v: "0",
                    n: 0
                });
            }
            // Both - show ratio
            else {
                ratioCandles.push({
                    t: time,
                    T: firstCandle.T,
                    s: `${longs.join("+")}/${shorts.join("+")}`,
                    i: interval,
                    o: (longOpen / shortOpen).toFixed(6),
                    c: (longClose / shortClose).toFixed(6),
                    h: (longHigh / shortLow).toFixed(6),
                    l: (longLow / shortHigh).toFixed(6),
                    v: "0",
                    n: 0
                });
            }
        }

        return ratioCandles;
    }

    // ============ SELECTION FUNCTIONS ============
    function selectLong(coin: string) {
        if (!selectedLongs.includes(coin)) {
            selectedLongs = [...selectedLongs, coin];
            // Remove from shorts if present
            if (selectedShorts.includes(coin)) {
                selectedShorts = selectedShorts.filter(c => c !== coin);
            }
        }
        longSearchInput = "";
        showLongDropdown = false;
        updateChart();
    }

    function removeLong(coin: string) {
        selectedLongs = selectedLongs.filter(c => c !== coin);
        updateChart();
    }

    function selectShort(coin: string) {
        if (!selectedShorts.includes(coin)) {
            selectedShorts = [...selectedShorts, coin];
            // Remove from longs if present
            if (selectedLongs.includes(coin)) {
                selectedLongs = selectedLongs.filter(c => c !== coin);
            }
        }
        shortSearchInput = "";
        showShortDropdown = false;
        updateChart();
    }

    function removeShort(coin: string) {
        selectedShorts = selectedShorts.filter(c => c !== coin);
        updateChart();
    }

    function selectPearMarket(market: PearMarket) {
        selectedLongs = market.longAssets.map(a => a.asset);
        selectedShorts = market.shortAssets.map(a => a.asset);
        pairSearchInput = "";
        showPairSearchResults = false;
        updateChart();
    }

    function clearAllSelections() {
        selectedLongs = [];
        selectedShorts = [];
        candles = [];
        chartError = null;
    }

    // ============ CHART FUNCTIONS ============
    async function updateChart() {
        const key = pairKey();
        if (!key) {
            candles = [];
            return;
        }
        await loadChart(key, chartInterval, true);
    }

    function handleRangeChange(hours: number) {
        chartTimeRange = hours;
        
        if (!isIntervalValid(chartInterval, hours)) {
            const intervals = ["5m", "15m", "1h", "4h"];
            const validIntervals = intervals.filter(i => isIntervalValid(i, hours));
            
            if (validIntervals.length > 0) {
                chartInterval = validIntervals[validIntervals.length - 1] as any;
            } else {
                chartInterval = "5m";
            }
        }

        const key = pairKey();
        if (key) loadChart(key, chartInterval);
    }

    async function loadChart(pair: string, interval: string, showLoading: boolean = true) {
        if (showLoading) isLoadingChart = true;
        chartError = null;
        
        try {
            const newCandles = await fetchPairCandles(pair, interval, chartTimeRange);
            if (pairKey() === pair) {
                candles = newCandles;
                //await tick();
                drawChart();
            }
        } catch (err) {
            console.error("Failed to load chart:", err);
            if (pairKey() === pair) {
                chartError = `Failed to fetch data: ${err instanceof Error ? err.message : 'Unknown error'}`;
            }
        } finally {
            if (showLoading) isLoadingChart = false;
        }
    }

    function drawChart() {
        if (!chartCanvas || candles.length === 0) return;

        const ctx = chartCanvas.getContext("2d");
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = chartCanvas.getBoundingClientRect();

        chartCanvas.width = rect.width * dpr;
        chartCanvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const width = rect.width;
        const height = rect.height;
        const padding = { top: 20, right: 80, bottom: 30, left: 10 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Background
        ctx.fillStyle = "#0a0a0a";
        ctx.fillRect(0, 0, width, height);

        // Calculate price range
        const prices = candles.flatMap((c) => [parseFloat(c.h), parseFloat(c.l)]);
        const minPrice = Math.min(...prices);
        const maxPrice = Math.max(...prices);
        const priceRange = maxPrice - minPrice || 1;

        const avgPrice = (maxPrice + minPrice) / 2;
        const decimals = avgPrice < 0.001 ? 8 : avgPrice < 1 ? 6 : avgPrice < 10 ? 4 : avgPrice < 100 ? 3 : 2;

        // Draw grid lines
        ctx.strokeStyle = "#1f1f1f";
        ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (chartHeight / 5) * i;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();

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

            // Price label
            ctx.fillStyle = "#3b82f6";
            ctx.fillRect(width - padding.right, y - 10, 75, 20);
            ctx.fillStyle = "#fff";
            ctx.font = "bold 10px monospace";
            ctx.fillText(currentPrice.toFixed(decimals), width - padding.right + 3, y + 4);
        }

        // Draw time labels
        const timeLabels = 5;
        ctx.fillStyle = "#666";
        ctx.font = "10px monospace";
        ctx.textAlign = "center";
        for (let i = 0; i <= timeLabels; i++) {
            const idx = Math.floor((candles.length - 1) * (i / timeLabels));
            if (candles[idx]) {
                const x = padding.left + idx * candleSpacing + candleSpacing / 2;
                const time = new Date(candles[idx].t);
                ctx.fillText(time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), x, height - 10);
            }
        }
    }

    // ============ LIFECYCLE ============
    onMount(async () => {
        await fetchAvailableCoins();
        await fetchPearMarkets();
        
        // Set up chart refresh
        chartRefreshInterval = setInterval(() => {
            const key = pairKey();
            if (key && candles.length > 0) {
                loadChart(key, chartInterval, false);
            }
        }, 10000);
    });

    onDestroy(() => {
        if (chartRefreshInterval) clearInterval(chartRefreshInterval);
    });

    // Redraw chart when candles change
    $effect(() => {
        if (chartCanvas && candles.length > 0) {
            drawChart();
        }
    });
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
                        <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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
                            <div class="rounded-md border bg-muted/50 p-3 text-sm font-mono">
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
                    {/if}
                </Card.Content>
            </Card.Root>
        </div>

    {:else if step === "logged-in" && currentUser && activeLobby}
        <div class="mx-auto max-w-4xl space-y-6 pb-20">
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
                                <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                                    DEMO
                                </span>
                            {/if}
                        </div>
                        <p class="text-sm text-muted-foreground">
                            Total: <span class="font-mono font-bold">${userBalance.toFixed(2)}</span>
                            <span class="mx-1">|</span>
                            Cash: <span class="font-mono">${userCashBalance.toFixed(2)}</span>
                            <span class="mx-1">|</span>
                            In Trades: <span class="font-mono">${userPositionsValue.toFixed(2)}</span>
                            {#if activeLobby.isDemo}
                                <span class="text-purple-600 ml-1">(Paper)</span>
                            {/if}
                            <span class={getStatusColor(activeLobby.status)}>
                                - {activeLobby.status}
                            </span>
                        </p>
                    </div>
                </div>
            </div>

            <Card.Root>
                <Card.Header>
                    <Card.Title class="flex items-center gap-2 text-lg">
                        <Search class="size-5" />
                        Quick Pair Search
                    </Card.Title>
                </Card.Header>
                <Card.Content class="space-y-4">
                    <div class="relative">
                        <Input
                            placeholder="Search pairs (e.g., BTC, ETH, SOL...)"
                            bind:value={pairSearchInput}
                            onfocus={() => (showPairSearchResults = true)}
                            onblur={() => setTimeout(() => (showPairSearchResults = false), 200)}
                            class="pl-10"
                        />
                        <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                        
                        {#if showPairSearchResults && filteredPearMarkets().length > 0}
                            <div class="absolute z-20 w-full mt-1 bg-background border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                                {#each filteredPearMarkets() as market}
                                    <button
                                        type="button"
                                        class="w-full px-4 py-3 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0"
                                        onmousedown={() => selectPearMarket(market)}
                                    >
                                        <div class="flex items-center justify-between">
                                            <span class="font-medium">{formatMarketDisplay(market)}</span>
                                            <span class={parseFloat(market.change24h) >= 0 ? "text-green-500" : "text-red-500"}>
                                                {parseFloat(market.change24h) >= 0 ? "+" : ""}{parseFloat(market.change24h).toFixed(2)}%
                                            </span>
                                        </div>
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </div>

                    {#if !isLoadingMarkets && (topGainers.length > 0 || topLosers.length > 0)}
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <h4 class="text-sm font-medium text-green-500 flex items-center gap-1">
                                    <TrendingUp class="size-4" />
                                    Top Gainers (24h)
                                </h4>
                                <div class="space-y-1">
                                    {#each topGainers as market}
                                        <button
                                            type="button"
                                            class="w-full px-3 py-2 text-left text-sm rounded-md border border-green-500/20 hover:bg-green-500/10 transition-colors"
                                            onclick={() => selectPearMarket(market)}
                                        >
                                            <div class="flex items-center justify-between">
                                                <span class="font-medium truncate">{formatMarketDisplay(market)}</span>
                                                <span class="text-green-500 text-xs font-mono">
                                                    +{parseFloat(market.change24h).toFixed(2)}%
                                                </span>
                                            </div>
                                        </button>
                                    {/each}
                                </div>
                            </div>

                            <div class="space-y-2">
                                <h4 class="text-sm font-medium text-red-500 flex items-center gap-1">
                                    <TrendingDown class="size-4" />
                                    Top Losers (24h)
                                </h4>
                                <div class="space-y-1">
                                    {#each topLosers as market}
                                        <button
                                            type="button"
                                            class="w-full px-3 py-2 text-left text-sm rounded-md border border-red-500/20 hover:bg-red-500/10 transition-colors"
                                            onclick={() => selectPearMarket(market)}
                                        >
                                            <div class="flex items-center justify-between">
                                                <span class="font-medium truncate">{formatMarketDisplay(market)}</span>
                                                <span class="text-red-500 text-xs font-mono">
                                                    {parseFloat(market.change24h).toFixed(2)}%
                                                </span>
                                            </div>
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        </div>
                    {:else if isLoadingMarkets}
                        <div class="text-center py-4 text-muted-foreground">Loading trending pairs...</div>
                    {/if}
                </Card.Content>
            </Card.Root>

            <Card.Root>
                <Card.Header>
                    <div class="flex items-center justify-between">
                        <div>
                            <Card.Title>Build Your Pair</Card.Title>
                            <Card.Description>
                                Select assets you want to go long (bullish) and/or short (bearish)
                            </Card.Description>
                        </div>
                        {#if selectedLongs.length > 0 || selectedShorts.length > 0}
                            <Button variant="outline" size="sm" onclick={clearAllSelections}>
                                <X class="size-4 mr-1" />
                                Clear All
                            </Button>
                        {/if}
                    </div>
                </Card.Header>
                <Card.Content class="space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="space-y-3 p-4 border-2 border-green-500/30 rounded-lg bg-green-500/5">
                            <Label class="text-green-500 flex items-center gap-2 text-base font-semibold">
                                <TrendingUp class="size-5" />
                                Long (Bullish)
                            </Label>
                            <div class="flex flex-wrap gap-2 min-h-[40px] p-2 bg-background/50 rounded-md">
                                {#if selectedLongs.length === 0}
                                    <span class="text-muted-foreground text-sm italic">Click to add assets...</span>
                                {/if}
                                {#each selectedLongs as coin}
                                    <span class="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-green-500 text-white rounded-full font-medium">
                                        {coin}
                                        <button type="button" class="hover:bg-white/20 rounded-full p-0.5 ml-1" onclick={() => removeLong(coin)}>
                                            <X class="size-3" />
                                        </button>
                                    </span>
                                {/each}
                            </div>
                            <div class="relative">
                                <Input
                                    placeholder={isLoadingCoins ? "Loading coins..." : "Search (BTC, ETH, SOL...)"}
                                    bind:value={longSearchInput}
                                    onfocus={() => (showLongDropdown = true)}
                                    onblur={() => setTimeout(() => (showLongDropdown = false), 200)}
                                    disabled={isLoadingCoins}
                                    class="border-green-500/30 focus:border-green-500"
                                />
                                {#if showLongDropdown && filteredLongCoins.length > 0}
                                    <div class="absolute z-10 w-full mt-1 bg-background border border-green-500/30 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                        {#each filteredLongCoins as coin}
                                            <button type="button" class="w-full px-4 py-2.5 text-left hover:bg-green-500/10 transition-colors font-medium" onmousedown={() => selectLong(coin)}>
                                                {coin}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>

                        <div class="space-y-3 p-4 border-2 border-red-500/30 rounded-lg bg-red-500/5">
                            <Label class="text-red-500 flex items-center gap-2 text-base font-semibold">
                                <TrendingDown class="size-5" />
                                Short (Bearish)
                            </Label>
                            <div class="flex flex-wrap gap-2 min-h-[40px] p-2 bg-background/50 rounded-md">
                                {#if selectedShorts.length === 0}
                                    <span class="text-muted-foreground text-sm italic">Click to add assets...</span>
                                {/if}
                                {#each selectedShorts as coin}
                                    <span class="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-red-500 text-white rounded-full font-medium">
                                        {coin}
                                        <button type="button" class="hover:bg-white/20 rounded-full p-0.5 ml-1" onclick={() => removeShort(coin)}>
                                            <X class="size-3" />
                                        </button>
                                    </span>
                                {/each}
                            </div>
                            <div class="relative">
                                <Input
                                    placeholder={isLoadingCoins ? "Loading coins..." : "Search (BTC, ETH, SOL...)"}
                                    bind:value={shortSearchInput}
                                    onfocus={() => (showShortDropdown = true)}
                                    onblur={() => setTimeout(() => (showShortDropdown = false), 200)}
                                    disabled={isLoadingCoins}
                                    class="border-red-500/30 focus:border-red-500"
                                />
                                {#if showShortDropdown && filteredShortCoins.length > 0}
                                    <div class="absolute z-10 w-full mt-1 bg-background border border-red-500/30 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                        {#each filteredShortCoins as coin}
                                            <button type="button" class="w-full px-4 py-2.5 text-left hover:bg-red-500/10 transition-colors font-medium" onmousedown={() => selectShort(coin)}>
                                                {coin}
                                            </button>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </div>
                </Card.Content>
            </Card.Root>

            <Card.Root>
                <Card.Header class="flex flex-row items-center justify-between space-y-0 pb-2">
                    <div>
                        <Card.Title class="text-xl">
                            {#if selectedLongs.length > 0 || selectedShorts.length > 0}
                                {formatPairDisplay(pairKey())}
                            {:else}
                                Select Assets to View Chart
                            {/if}
                        </Card.Title>
                    </div>
                    <div class="flex flex-col gap-2 items-end">
                         <div class="flex gap-1">
                            {#each ["5m", "15m", "1h", "4h"] as interval}
                                {@const isValid = isIntervalValid(interval, chartTimeRange)}
                                <button
                                    class="px-3 py-1 text-sm rounded transition-colors {chartInterval === interval ? 'bg-primary text-primary-foreground' : isValid ? 'bg-muted hover:bg-muted/80' : 'bg-muted/30 text-muted-foreground cursor-not-allowed'}"
                                    onclick={() => {
                                        if (!isValid) return;
                                        chartInterval = interval as "5m" | "15m" | "1h" | "4h";
                                        const key = pairKey();
                                        if (key) loadChart(key, interval);
                                    }}
                                    disabled={!isValid || !pairKey()}
                                >
                                    {interval}
                                </button>
                            {/each}
                            <button
                                class="px-3 py-1 text-sm rounded bg-muted hover:bg-muted/80 ml-2 flex items-center gap-1"
                                onclick={() => {
                                    const key = pairKey();
                                    if (key) loadChart(key, chartInterval);
                                }}
                                disabled={isLoadingChart || !pairKey()}
                            >
                                <RefreshCw class="size-3 {isLoadingChart ? 'animate-spin' : ''}" />
                            </button>
                        </div>
                        <div class="flex gap-1 items-center">
                            <span class="text-xs text-muted-foreground mr-1">Range:</span>
                            {#each timeRangeOptions as option}
                                <button
                                    class="px-2 py-0.5 text-xs rounded transition-colors {chartTimeRange === option.hours ? 'bg-blue-500 text-white' : 'bg-muted hover:bg-muted/80'}"
                                    onclick={() => handleRangeChange(option.hours)}
                                    disabled={!pairKey()}
                                >
                                    {option.label}
                                </button>
                            {/each}
                        </div>
                    </div>
                </Card.Header>
                <Card.Content>
                    <div class="relative w-full h-80 bg-[#0a0a0a] rounded-lg overflow-hidden">
                        <canvas
                            bind:this={chartCanvas}
                            width="800"
                            height="320"
                            class="w-full h-full cursor-crosshair"
                            onmousemove={(e) => {
                                if (!chartCanvas || candles.length === 0) return;
                                const rect = chartCanvas.getBoundingClientRect();
                                const x = e.clientX - rect.left;
                                const y = e.clientY - rect.top;
                                
                                const padding = { top: 20, right: 80, bottom: 30, left: 10 };
                                const chartWidth = rect.width - padding.left - padding.right;
                                const chartHeight = rect.height - padding.top - padding.bottom;
                                
                                if (x >= padding.left && x <= rect.width - padding.right && y >= padding.top && y <= rect.height - padding.bottom) {
                                    const candleIndex = Math.floor(((x - padding.left) / chartWidth) * candles.length);
                                    const clampedIndex = Math.max(0, Math.min(candleIndex, candles.length - 1));
                                    const candle = candles[clampedIndex];
                                    const candleTime = new Date(candle.t);
                                    
                                    const prices = candles.flatMap((c) => [parseFloat(c.h), parseFloat(c.l)]);
                                    const minPrice = Math.min(...prices);
                                    const maxPrice = Math.max(...prices);
                                    const priceRange = maxPrice - minPrice || 1;

                                    const closePrice = parseFloat(candle.c);
                                    const snapY = padding.top + ((maxPrice - closePrice) / priceRange) * chartHeight;
                                    
                                    const candleSpacing = chartWidth / candles.length;
                                    const snappedX = padding.left + clampedIndex * candleSpacing + candleSpacing / 2;

                                    crosshairX = (snappedX / rect.width) * 100;
                                    crosshairY = (snapY / rect.height) * 100;
                                    crosshairPrice = closePrice;
                                    crosshairTime = candleTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                                } else {
                                    crosshairX = null; crosshairY = null; crosshairPrice = null; crosshairTime = null;
                                }
                            }}
                            onmouseleave={() => {
                                crosshairX = null; crosshairY = null; crosshairPrice = null; crosshairTime = null;
                            }}
                        ></canvas>
                        
                        {#if crosshairX !== null && crosshairY !== null}
                            <div class="absolute top-0 bottom-0 w-px bg-blue-500/70 pointer-events-none" style="left: {crosshairX}%"></div>
                            <div class="absolute left-0 right-0 h-px bg-blue-500/70 pointer-events-none" style="top: {crosshairY}%"></div>
                            <div class="absolute right-0 bg-blue-500 text-white text-xs font-mono px-2 py-1 rounded-l pointer-events-none" style="top: {crosshairY}%; transform: translateY(-50%)">
                                {crosshairPrice !== null ? crosshairPrice.toFixed(2) : ''}
                            </div>
                        {/if}

                        {#if chartError}
                            <div class="absolute inset-0 flex flex-col items-center justify-center bg-red-950/90 text-red-400 p-4">
                                <p class="text-center font-medium">{chartError}</p>
                                <button class="mt-3 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg" onclick={() => loadChart(pairKey(), chartInterval, true)}>Retry</button>
                            </div>
                        {:else if isLoadingChart}
                            <div class="absolute inset-0 flex items-center justify-center text-muted-foreground bg-[#0a0a0a]">
                                <RefreshCw class="size-5 animate-spin mr-2" /> Loading chart...
                            </div>
                        {:else if candles.length === 0}
                            <div class="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-[#0a0a0a]">
                                <TrendingUp class="size-12 mb-3 opacity-30" />
                                <p class="text-lg font-medium">No chart data</p>
                            </div>
                        {/if}
                    </div>
                </Card.Content>
            </Card.Root>

            {#if activeLobby.status === "started"}
                <Card.Root>
                    <Card.Header>
                        <Card.Title>Open Pair Trade</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-4">
                        <div class="grid grid-cols-4 gap-4">
                            <div class="space-y-2">
                                <Label>Long</Label>
                                <Input bind:value={buyLongAsset} placeholder="BTC" />
                            </div>
                            <div class="space-y-2">
                                <Label>Short</Label>
                                <Input bind:value={buyShortAsset} placeholder="ETH" />
                            </div>
                            <div class="space-y-2">
                                <Label>USD</Label>
                                <Input type="number" bind:value={buyUsdValue} min={0.1} max={userBalance} />
                            </div>
                            <div class="space-y-2">
                                <Label>Leverage</Label>
                                <Input type="number" bind:value={buyLeverage} min={1} max={100} />
                            </div>
                        </div>
                        <div class="grid grid-cols-3 gap-4">
                            <div class="space-y-2">
                                <Label>Slippage</Label>
                                <Input type="number" bind:value={buySlippage} step={0.001} />
                            </div>
                            <div class="space-y-2">
                                <Label>Execution</Label>
                                <select bind:value={buyExecutionType} class="w-full h-10 px-3 rounded-md border bg-background">
                                    <option value="MARKET">MARKET</option>
                                    <option value="SYNC">SYNC</option>
                                    <option value="TWAP">TWAP</option>
                                </select>
                            </div>
                            <div class="flex items-end">
                                <Button onclick={buyPosition} disabled={buyingPosition || buyUsdValue > userBalance} class="w-full">
                                    {buyingPosition ? "Opening..." : "Open Trade"}
                                </Button>
                            </div>
                        </div>
                    </Card.Content>
                </Card.Root>

                {#if positions.length > 0}
                    <Card.Root>
                        <Card.Header>
                            <Card.Title>Your Positions</Card.Title>
                        </Card.Header>
                        <Card.Content>
                            <div class="space-y-2">
                                {#each positions as pos}
                                    <div class="flex items-center justify-between p-3 border rounded-md">
                                        <div>
                                            <div class="font-bold">
                                                <span class="text-green-600">Long {pos.longAssets?.[0]?.coin}</span> / <span class="text-red-600">Short {pos.shortAssets?.[0]?.coin}</span>
                                            </div>
                                            <span class="text-muted-foreground text-sm">{pos.longAssets?.[0]?.leverage}x leverage</span>
                                        </div>
                                        <div class="text-right">
                                            <div class="font-mono">${pos.marginUsed?.toFixed(2)}</div>
                                            <div class={pos.unrealizedPnl >= 0 ? "text-green-500" : "text-red-500"}>
                                                {pos.unrealizedPnl >= 0 ? "+" : ""}{pos.unrealizedPnl?.toFixed(2)}
                                            </div>
                                        </div>
                                        <Button onclick={() => closePosition(pos.positionId)} variant="outline" size="sm" disabled={closingPositionId === pos.positionId}>
                                            {closingPositionId === pos.positionId ? "Closing..." : "Close"}
                                        </Button>
                                    </div>
                                {/each}
                            </div>
                        </Card.Content>
                    </Card.Root>
                {/if}
            {/if}

            <Card.Root>
                <Card.Header>
                    <Card.Title class="flex items-center gap-2">
                        <Trophy class="size-5" />
                        {activeLobby.status === "finished" ? "Final Leaderboard" : "Leaderboard"}
                    </Card.Title>
                </Card.Header>
                <Card.Content>
                    <div class="space-y-2">
                        {#each leaderboard as entry}
                            <div class="flex items-center justify-between p-3 border rounded-md {entry.username === currentUser.username ? 'bg-muted' : ''}">
                                <div class="flex items-center gap-3">
                                    <span class="font-bold text-lg w-8">#{entry.rank}</span>
                                    <span>{entry.username}</span>
                                </div>
                                <div class="text-right">
                                    <div class="font-mono">${entry.totalValue.toFixed(2)}</div>
                                    <div class={entry.pnl >= 0 ? "text-green-500 text-sm" : "text-red-500 text-sm"}>
                                        {entry.pnl >= 0 ? "+" : ""}{entry.pnl.toFixed(2)}
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
            <div class="flex items-center justify-between">
                <div>
                    <h1 class="text-2xl font-bold">Welcome, {currentUser.username}</h1>
                    <p class="text-sm text-muted-foreground font-mono">{shortenAddress(currentUser.walletAddress)}</p>
                </div>
                <div class="flex items-center gap-2">
                    {#if !showCreateLobby}
                        <Button onclick={() => { showCreateLobby = true; newLobbyStartTime = getDefaultStartTime(); }}>
                            <Plus class="size-4" /> New Lobby
                        </Button>
                    {/if}
                    <Button onclick={logout} variant="outline" size="icon" title="Disconnect">
                        <LogOut class="size-4" />
                    </Button>
                </div>
            </div>

            {#if error}
                <div class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            {/if}

            {#if showCreateLobby}
                <Card.Root>
                    <Card.Header>
                        <Card.Title>Create New Lobby</Card.Title>
                    </Card.Header>
                    <Card.Content class="space-y-4">
                        <div class="space-y-2">
                            <Label for="lobbyName">Lobby Name</Label>
                            <Input id="lobbyName" bind:value={newLobbyName} placeholder="Enter lobby name" disabled={creatingLobby} />
                        </div>
                        <div class="space-y-2">
                            <Label for="startTime">Start Time</Label>
                            <Input id="startTime" type="datetime-local" bind:value={newLobbyStartTime} disabled={creatingLobby} />
                        </div>
                        <div class="grid grid-cols-2 gap-4">
                            <div class="space-y-2">
                                <Label for="duration">Duration (minutes)</Label>
                                <Input id="duration" type="number" bind:value={newLobbyDuration} min={5} max={120} disabled={creatingLobby} />
                            </div>
                            <div class="space-y-2">
                                <Label for="buyIn">{newLobbyIsDemo ? "Starting Balance" : "Buy-in Amount"}</Label>
                                <Input id="buyIn" type="number" bind:value={newLobbyBuyIn} min={100} disabled={creatingLobby} />
                            </div>
                        </div>
                        <div class="flex items-center gap-3 p-3 rounded-md border bg-muted/50">
                            <input id="isDemo" type="checkbox" bind:checked={newLobbyIsDemo} disabled={creatingLobby} class="h-4 w-4" />
                            <div>
                                <Label for="isDemo" class="cursor-pointer">Demo Mode (Paper Trading)</Label>
                                <p class="text-xs text-muted-foreground">{newLobbyIsDemo ? "No real money required. Players get paper money to trade." : "Real USDC payment required to join."}</p>
                            </div>
                        </div>
                    </Card.Content>
                    <Card.Footer class="flex gap-2">
                        <Button onclick={() => (showCreateLobby = false)} variant="outline" class="flex-1">Cancel</Button>
                        <Button onclick={createLobby} disabled={creatingLobby || !newLobbyName.trim()} class="flex-1">
                            {creatingLobby ? "Creating..." : "Create Lobby"}
                        </Button>
                    </Card.Footer>
                </Card.Root>
            {/if}

            <div class="space-y-4">
                <div class="flex items-center justify-between">
                    <h2 class="text-xl font-semibold">Lobbies</h2>
                    <Button onclick={loadLobbies} variant="ghost" size="sm" disabled={loadingLobbies}>
                        {loadingLobbies ? "Loading..." : "Refresh"}
                    </Button>
                </div>

                {#if loadingLobbies && lobbies.length === 0}
                    <div class="text-center text-muted-foreground py-8">Loading lobbies...</div>
                {:else if lobbies.length === 0}
                    <Card.Root>
                        <Card.Content class="py-8 text-center text-muted-foreground">No lobbies yet. Create one to get started!</Card.Content>
                    </Card.Root>
                {:else}
                    <div class="grid gap-4">
                        {#each lobbies as lobby}
                            <Card.Root>
                                <Card.Header>
                                    <div class="flex items-start justify-between">
                                        <div>
                                            <Card.Title>{lobby.name}</Card.Title>
                                            <Card.Description>Created by {lobby.creatorName}</Card.Description>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            {#if lobby.isDemo}
                                                <span class="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">DEMO</span>
                                            {/if}
                                            {#if lobby.hasJoined}
                                                <span class="text-sm font-medium text-green-600 dark:text-green-400">Joined</span>
                                            {/if}
                                            <span class={`text-sm font-medium ${getStatusColor(lobby.status)}`}>{lobby.status}</span>
                                        </div>
                                    </div>
                                </Card.Header>
                                <Card.Content>
                                    <div class="grid grid-cols-2 gap-4 text-sm">
                                        <div><span class="text-muted-foreground">Buy-in:</span> <span class="ml-2 font-medium">${lobby.buyIn}</span></div>
                                        <div><span class="text-muted-foreground">Players:</span> <span class="ml-2 font-medium">{lobby.participantCount}</span></div>
                                        <div><span class="text-muted-foreground">Starts:</span> <span class="ml-2">{formatDate(lobby.startTime)}</span></div>
                                        <div><span class="text-muted-foreground">Ends:</span> <span class="ml-2">{formatDate(lobby.endTime)}</span></div>
                                    </div>
                                </Card.Content>
                                <Card.Footer>
                                    {#if lobby.status === "not started" && !lobby.hasJoined}
                                        <Button onclick={() => joinLobby(lobby)} disabled={joiningLobbyId === lobby._id} class="w-full">
                                            {#if joiningLobbyId === lobby._id}
                                                {lobby.isDemo ? "Joining..." : "Paying..."}
                                            {:else if lobby.isDemo}
                                                Join Demo (${lobby.buyIn} Paper)
                                            {:else}
                                                Join Lobby (${lobby.buyIn} USDC)
                                            {/if}
                                        </Button>
                                    {:else if lobby.hasJoined}
                                        <Button onclick={() => enterLobby(lobby)} class="w-full">
                                            {lobby.isDemo ? "Trade (Demo)" : "Trade"}
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