export interface PositionAfterCreation {
  id: string;
}

export interface StopLossTakeProfit {
  type: string;
  value: number;
  isTrailing: boolean;
  trailingDeltaValue: number;
  trailingActivationValue: number;
}

export interface AssetPosition {
  coin: string;
  entryPrice: number;
  actualSize: number;
  leverage: number;
  marginUsed: number;
  positionValue: number;
  unrealizedPnl: number;
  entryPositionValue: number;
  initialWeight: number;
  fundingPaid: number;
}

export interface CreatePositionResult {
  success: boolean;
  orderId: string | null;
  positionId: string | null;
  error: string | null;
  newBalance?: number;
  positionCost?: number;
}

export interface SinglePositionAction {
  positionId: string;
  address: string;
  pearExecutionFlag: string;
  stopLoss: StopLossTakeProfit;
  takeProfit: StopLossTakeProfit;
  entryRatio: number;
  markRatio: number;
  entryPriceRatio: number;
  markPriceRatio: number;
  entryPositionValue: number;
  positionValue: number;
  marginUsed: number;
  unrealizedPnl: number;
  unrealizedPnlPercentage: number;
  longAssets: AssetPosition[];
  shortAssets: AssetPosition[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePositionConfig {
  slippage: number;
  executionType: "MARKET" | "SYNC" | "TWAP";
  leverage: number;
  usdValue: number;
  longAsset: string;
  shortAsset: string;
}

export interface ClosePositionConfig {
  executionType: "MARKET" | "TWAP";
  twapDuration?: number;
  twapIntervalSeconds?: number;
  randomizeExecution?: boolean;
  referralCode?: string;
}

export interface ClosePositionResult {
  success: boolean;
  realizedValue: number | null;
  newBalance: number | null;
  error: string | null;
}
