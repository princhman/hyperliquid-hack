/**
 * Price service using Binance public API
 * Fetches real-time prices for realistic P&L simulation
 */

import type { PriceService } from "../types";

const BINANCE_API = "https://api.binance.com/api/v3";

// Cache prices for 1 second to avoid rate limiting
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL = 1000; // 1 second

// Map Hyperliquid/Pear symbols to Binance symbols
const SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  ARB: "ARBUSDT",
  OP: "OPUSDT",
  AVAX: "AVAXUSDT",
  MATIC: "MATICUSDT",
  LINK: "LINKUSDT",
  UNI: "UNIUSDT",
  AAVE: "AAVEUSDT",
  CRV: "CRVUSDT",
  MKR: "MKRUSDT",
  SNX: "SNXUSDT",
  COMP: "COMPUSDT",
  YFI: "YFIUSDT",
  SUSHI: "SUSHIUSDT",
  DOGE: "DOGEUSDT",
  SHIB: "SHIBUSDT",
  PEPE: "PEPEUSDT",
  WIF: "WIFUSDT",
  BONK: "BONKUSDT",
  FLOKI: "FLOKIUSDT",
  APE: "APEUSDT",
  LDO: "LDOUSDT",
  RPL: "RPLUSDT",
  FXS: "FXSUSDT",
  BLUR: "BLURUSDT",
  APT: "APTUSDT",
  SUI: "SUIUSDT",
  SEI: "SEIUSDT",
  TIA: "TIAUSDT",
  INJ: "INJUSDT",
  NEAR: "NEARUSDT",
  ATOM: "ATOMUSDT",
  DOT: "DOTUSDT",
  FTM: "FTMUSDT",
  ALGO: "ALGOUSDT",
  XRP: "XRPUSDT",
  ADA: "ADAUSDT",
  XLM: "XLMUSDT",
  TRX: "TRXUSDT",
  EOS: "EOSUSDT",
  XTZ: "XTZUSDT",
  KAVA: "KAVAUSDT",
  RUNE: "RUNEUSDT",
  GMX: "GMXUSDT",
  DYDX: "DYDXUSDT",
  JUP: "JUPUSDT",
  WLD: "WLDUSDT",
  STRK: "STRKUSDT",
  PYTH: "PYTHUSDT",
  JTO: "JTOUSDT",
  MEME: "MEMEUSDT",
  ORDI: "ORDIUSDT",
  SATS: "1000SATSUSDT",
  RATS: "RATSUSDT",
};

function toBinanceSymbol(symbol: string): string {
  // Remove any suffixes like -PERP
  const baseSymbol = symbol.replace(/-PERP$/, "").toUpperCase();
  return SYMBOL_MAP[baseSymbol] || `${baseSymbol}USDT`;
}

export class BinancePriceService implements PriceService {
  async getPrice(symbol: string): Promise<number> {
    const cached = priceCache.get(symbol);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.price;
    }

    const binanceSymbol = toBinanceSymbol(symbol);

    try {
      const res = await fetch(`${BINANCE_API}/ticker/price?symbol=${binanceSymbol}`);

      if (!res.ok) {
        console.warn(`Failed to fetch price for ${binanceSymbol}: ${res.statusText}`);
        // Return cached price if available, otherwise throw
        if (cached) return cached.price;
        throw new Error(`Failed to fetch price for ${symbol}`);
      }

      const data = await res.json();
      const price = parseFloat(data.price);

      priceCache.set(symbol, { price, timestamp: Date.now() });

      return price;
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
      if (cached) return cached.price;
      throw error;
    }
  }

  async getPrices(symbols: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Check cache first
    const uncachedSymbols: string[] = [];
    for (const symbol of symbols) {
      const cached = priceCache.get(symbol);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        prices.set(symbol, cached.price);
      } else {
        uncachedSymbols.push(symbol);
      }
    }

    if (uncachedSymbols.length === 0) {
      return prices;
    }

    // Fetch all prices in one request
    try {
      const binanceSymbols = uncachedSymbols.map(toBinanceSymbol);
      const res = await fetch(
        `${BINANCE_API}/ticker/price?symbols=${JSON.stringify(binanceSymbols)}`
      );

      if (!res.ok) {
        throw new Error(`Failed to fetch prices: ${res.statusText}`);
      }

      const data: Array<{ symbol: string; price: string }> = await res.json();

      // Map back to original symbols
      for (let i = 0; i < uncachedSymbols.length; i++) {
        const originalSymbol = uncachedSymbols[i];
        const binanceSymbol = binanceSymbols[i];
        const priceData = data.find((d) => d.symbol === binanceSymbol);

        if (priceData) {
          const price = parseFloat(priceData.price);
          prices.set(originalSymbol, price);
          priceCache.set(originalSymbol, { price, timestamp: Date.now() });
        }
      }
    } catch (error) {
      console.error("Error fetching prices:", error);
      // Fill in missing prices with cached values or throw
      for (const symbol of uncachedSymbols) {
        const cached = priceCache.get(symbol);
        if (cached) {
          prices.set(symbol, cached.price);
        }
      }
    }

    return prices;
  }

  subscribeToPrices(
    symbols: string[],
    callback: (prices: Map<string, number>) => void
  ): () => void {
    // Use polling instead of WebSocket for simplicity
    const interval = setInterval(async () => {
      try {
        const prices = await this.getPrices(symbols);
        callback(prices);
      } catch (error) {
        console.error("Error in price subscription:", error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }
}

// Singleton instance
export const priceService = new BinancePriceService();
