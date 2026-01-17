<script lang="ts">
    import { signUserSignedAction } from "@nktkas/hyperliquid/signing";
    import { ApproveAgentTypes } from "@nktkas/hyperliquid/api/exchange";
    import { browser } from "$app/environment";

    const clientId = "HLHackathon5";
    const STORAGE_KEY = "hyperliquid_session";

    interface SessionData {
        walletAddress: string;
        agentWalletAddress: string;
        accessToken: string;
        isAgentApproved: boolean;
    }

    interface Order {
        id: string;
        asset: string;
        amount: number;
        price: number;
    }

    interface PositionAssetDetail {
        coin: string;
        entryPrice: number;
        actualSize: number;
        leverage: number;
        marginUsed: number;
        positionValue: number;
        unrealizedPnl: number;
        entryPositionValue: number;
        initialWeight: number;
        fundingPaid?: number;
    }

    interface TpSlThreshold {
        type:
            | "PERCENTAGE"
            | "DOLLAR"
            | "POSITION_VALUE"
            | "PRICE"
            | "PRICE_RATIO"
            | "WEIGHTED_RATIO";
        value: number;
        isTrailing?: boolean;
        trailingDeltaValue?: number;
        trailingActivationValue?: number;
    }

    interface Position {
        positionId: string;
        address: string;
        pearExecutionFlag: string;
        stopLoss: TpSlThreshold | null;
        takeProfit: TpSlThreshold | null;
        entryRatio: number;
        markRatio: number;
        entryPriceRatio?: number;
        markPriceRatio?: number;
        entryPositionValue: number;
        positionValue: number;
        marginUsed: number;
        unrealizedPnl: number;
        unrealizedPnlPercentage: number;
        longAssets: PositionAssetDetail[];
        shortAssets: PositionAssetDetail[];
        createdAt: string;
        updatedAt: string;
    }

    // Initialize from localStorage directly (only in browser)
    const getInitialSession = (): SessionData | null => {
        if (!browser) return null;
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                return JSON.parse(stored) as SessionData;
            } catch {
                localStorage.removeItem(STORAGE_KEY);
            }
        }
        return null;
    };

    let error = $state("No error");
    let session = $state<SessionData | null>(getInitialSession());
    let orders = $state<Order[]>([]);
    let positions = $state<Position[]>([]);
    let closingPositionId = $state<string | null>(null);
    let isCreatingPosition = $state(false);
    let isApprovingBuilder = $state(false);
    let builderApproved = $state(false);
    let currentBuilderFeeRate = $state<string | null>(null);

    const PEAR_BUILDER_ADDRESS = "0xA47D4d99191db54A4829cdf3de2417E527c3b042";
    const REQUIRED_FEE_RATE = "0.1%";

    // New position form state
    let newPositionForm = $state({
        longAsset: "BTC",
        shortAsset: "ETH",
        usdValue: 12,
        leverage: 5,
        slippage: 0.02,
        executionType: "MARKET" as "SYNC" | "MARKET" | "TWAP",
    });

    // Fetch orders and positions on initial load if session exists
    $effect(() => {
        if (browser && session?.accessToken) {
            fetchOrders(session.accessToken);
            fetchPositions(session.accessToken);
            checkBuilderApproved(session.walletAddress).then((approved) => {
                builderApproved = approved;
            });
        }
    });

    // Save session to localStorage
    const saveSession = (data: SessionData) => {
        session = data;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    };

    // Clear session
    const clearSession = () => {
        session = null;
        localStorage.removeItem(STORAGE_KEY);
    };

    // Create a wallet adapter for MetaMask that's compatible with the SDK
    const createMetaMaskWallet = (address: string) => ({
        address: address as `0x${string}`,
        signTypedData: async (params: {
            domain: Record<string, unknown>;
            types: Record<string, { name: string; type: string }[]>;
            primaryType: string;
            message: Record<string, unknown>;
        }) => {
            const signature = await window.ethereum.request({
                method: "eth_signTypedData_v4",
                params: [
                    address,
                    JSON.stringify({
                        domain: params.domain,
                        types: {
                            EIP712Domain: [
                                { name: "name", type: "string" },
                                { name: "version", type: "string" },
                                { name: "chainId", type: "uint256" },
                                { name: "verifyingContract", type: "address" },
                            ],
                            ...params.types,
                        },
                        primaryType: params.primaryType,
                        message: params.message,
                    }),
                ],
            });
            return signature as `0x${string}`;
        },
    });

    const getEIP712 = async (address: string) => {
        const response = await fetch(
            `https://hl-v2.pearprotocol.io/auth/eip712-message?address=${address}&clientId=${clientId}`,
            {
                method: "GET",
                headers: {
                    Accept: "*/*",
                },
            },
        );

        const data = await response.json();
        return data;
    };

    const login = async (
        address: string,
        signature: string,
        timestamp: number,
    ) => {
        const response = await fetch(
            "https://hl-v2.pearprotocol.io/auth/login",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    method: "eip712",
                    address: address,
                    clientId: clientId,
                    details: {
                        signature: signature,
                        timestamp: timestamp,
                    },
                }),
            },
        );

        const data = await response.json();
        return data;
    };

    const checkAgentWallet = async (token: string) => {
        const response = await fetch(
            "https://hl-v2.pearprotocol.io/agentWallet",
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "*/*",
                },
            },
        );

        return await response.json();
    };

    const createAgentWallet = async (token: string) => {
        const response = await fetch(
            "https://hl-v2.pearprotocol.io/agentWallet",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: "*/*",
                },
            },
        );

        return await response.json();
    };

    // Check if agent is already approved on Hyperliquid
    const checkAgentApproved = async (
        userAddress: string,
        agentAddress: string,
    ): Promise<boolean> => {
        const response = await fetch("https://api.hyperliquid.xyz/info", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                type: "extraAgents",
                user: userAddress,
            }),
        });

        const agents = await response.json();
        console.log("Existing agents:", agents);

        // Check if agentAddress is in the list of approved agents
        if (!Array.isArray(agents)) {
            return false;
        }
        return agents.some(
            (agent: { address: string; name: string; validUntil: number }) =>
                agent.address.toLowerCase() === agentAddress.toLowerCase(),
        );
    };

    const approveAgentWallet = async (
        walletAddress: string,
        agentAddress: string,
    ) => {
        const wallet = createMetaMaskWallet(walletAddress);
        const nonce = Date.now();

        const action = {
            type: "approveAgent" as const,
            signatureChainId: "0xa4b1" as `0x${string}`, // Arbitrum
            hyperliquidChain: "Mainnet" as const,
            agentAddress: agentAddress.toLowerCase() as `0x${string}`,
            agentName: "Pear Pool",
            nonce,
        };

        // Sign using the SDK's signUserSignedAction
        const signature = await signUserSignedAction({
            wallet,
            action,
            types: ApproveAgentTypes,
        });

        // Send to Hyperliquid API
        const response = await fetch("https://api.hyperliquid.xyz/exchange", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                action,
                nonce,
                signature,
            }),
        });

        return await response.json();
    };

    const checkBuilderApproved = async (
        userAddress: string,
    ): Promise<boolean> => {
        try {
            const response = await fetch("https://api.hyperliquid.xyz/info", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    type: "maxBuilderFee",
                    user: userAddress,
                    builder: PEAR_BUILDER_ADDRESS,
                }),
            });

            const result = await response.json();
            console.log("Builder approval status:", result);
            // Result is a plain number in tenths of a basis point (e.g., 100 = 0.01%)
            // Convert to percentage string for display
            const rateInDecibps = typeof result === "number" ? result : 0;
            const ratePercent = rateInDecibps / 1000; // Convert decibps to percentage
            currentBuilderFeeRate =
                rateInDecibps > 0 ? `${ratePercent}%` : null;
            // Required rate is 0.1% = 100 decibps
            const requiredDecibps = 100; // 0.1% in tenths of basis points
            return rateInDecibps >= requiredDecibps;
        } catch (err) {
            console.error("Failed to check builder approval:", err);
            return false;
        }
    };

    const approveBuilder = async (walletAddress: string) => {
        isApprovingBuilder = true;
        try {
            const wallet = createMetaMaskWallet(walletAddress);
            const nonce = Date.now();

            const action = {
                type: "approveBuilderFee" as const,
                signatureChainId: "0xa4b1" as `0x${string}`,
                hyperliquidChain: "Mainnet" as const,
                maxFeeRate: "0.1%",
                builder: PEAR_BUILDER_ADDRESS.toLowerCase() as `0x${string}`,
                nonce,
            };

            const signature = await signUserSignedAction({
                wallet,
                action,
                types: {
                    "HyperliquidTransaction:ApproveBuilderFee": [
                        { name: "hyperliquidChain", type: "string" },
                        { name: "maxFeeRate", type: "string" },
                        { name: "builder", type: "address" },
                        { name: "nonce", type: "uint64" },
                    ],
                },
            });

            const response = await fetch(
                "https://api.hyperliquid.xyz/exchange",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        action,
                        nonce,
                        signature,
                    }),
                },
            );

            const result = await response.json();
            console.log("Approve builder result:", result);

            if (result.status === "ok") {
                builderApproved = await checkBuilderApproved(walletAddress);
            } else {
                error = result.response || "Failed to approve builder";
            }

            return result;
        } catch (err) {
            console.error("Failed to approve builder:", err);
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to approve builder";
        } finally {
            isApprovingBuilder = false;
        }
    };

    const getAddress = async () => {
        if (typeof window.ethereum === "undefined") {
            error = "MetaMask not installed";
            return;
        }

        try {
            const accounts = await window.ethereum.request({
                method: "eth_requestAccounts",
            });

            const walletAddress = accounts[0] as string;
            const eip712 = await getEIP712(walletAddress);
            console.log("EIP712 message:", eip712);

            const typesWithDomain = {
                EIP712Domain: [
                    { name: "name", type: "string" },
                    { name: "version", type: "string" },
                    { name: "chainId", type: "uint256" },
                    { name: "verifyingContract", type: "address" },
                ],
                ...eip712.types,
            };

            const signature = await window.ethereum.request({
                method: "eth_signTypedData_v4",
                params: [
                    walletAddress,
                    JSON.stringify({
                        domain: eip712.domain,
                        types: typesWithDomain,
                        primaryType: eip712.primaryType,
                        message: eip712.message,
                    }),
                ],
            });

            const authData = await login(
                walletAddress,
                signature as string,
                eip712.message.timestamp,
            );
            console.log(authData);

            let agentWallet = await checkAgentWallet(authData.accessToken);
            if (agentWallet && Object.keys(agentWallet).length > 0) {
                console.log("Agent wallet:", agentWallet);
            } else {
                console.log("No agent wallet found");
                agentWallet = await createAgentWallet(authData.accessToken);
                console.log("New agent wallet:", agentWallet);
            }

            // Check if agent is already approved on Hyperliquid
            const isAlreadyApproved = await checkAgentApproved(
                walletAddress,
                agentWallet.agentWalletAddress,
            );

            if (isAlreadyApproved) {
                console.log("Agent already approved!");
                saveSession({
                    walletAddress,
                    agentWalletAddress: agentWallet.agentWalletAddress,
                    accessToken: authData.accessToken,
                    isAgentApproved: true,
                });
                // Check builder approval
                const isBuilderApproved =
                    await checkBuilderApproved(walletAddress);
                builderApproved = isBuilderApproved;
                return;
            }

            // Save session before attempting approval
            saveSession({
                walletAddress,
                agentWalletAddress: agentWallet.agentWalletAddress,
                accessToken: authData.accessToken,
                isAgentApproved: false,
            });

            // Approve the agent wallet using the proper Hyperliquid SDK signing
            const result = await approveAgentWallet(
                walletAddress,
                agentWallet.agentWalletAddress,
            );
            console.log("Approve agent result:", result);

            // Update session if approval succeeded
            if (result.status === "ok") {
                saveSession({
                    walletAddress,
                    agentWalletAddress: agentWallet.agentWalletAddress,
                    accessToken: authData.accessToken,
                    isAgentApproved: true,
                });
            }
        } catch (err) {
            console.error(err);
            error = err instanceof Error ? err.message : "Unknown error";
        }
    };

    const spotOrder = async (token: string) => {
        const response = await fetch(
            "https://hl-v2.pearprotocol.io/orders/spot",
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    asset: "USDH",
                    isBuy: true,
                    amount: 0.1,
                }),
            },
        );

        return await response.json();
    };

    const fetchOrders = async (token: string) => {
        try {
            const response = await fetch(
                "https://hl-v2.pearprotocol.io/orders/open",
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "*/*",
                    },
                },
            );

            const data = await response.json();
            orders = Array.isArray(data) ? data : [];
            console.log("Orders:", orders);
        } catch (err) {
            console.error("Failed to fetch orders:", err);
            orders = [];
        }
    };

    const fetchPositions = async (token: string) => {
        try {
            const response = await fetch(
                "https://hl-v2.pearprotocol.io/positions",
                {
                    method: "GET",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: "*/*",
                    },
                },
            );

            const data = await response.json();
            positions = Array.isArray(data) ? data : [];
            console.log("Positions:", positions);
        } catch (err) {
            console.error("Failed to fetch positions:", err);
            positions = [];
        }
    };

    const closePosition = async (
        token: string,
        positionId: string,
        executionType: "MARKET" | "TWAP" = "MARKET",
    ) => {
        closingPositionId = positionId;
        try {
            const response = await fetch(
                `https://hl-v2.pearprotocol.io/positions/${positionId}/close`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        executionType,
                    }),
                },
            );

            const data = await response.json();
            console.log("Close position result:", data);
            await fetchPositions(token);
            return data;
        } catch (err) {
            console.error("Failed to close position:", err);
            error =
                err instanceof Error ? err.message : "Failed to close position";
        } finally {
            closingPositionId = null;
        }
    };

    const closeAllPositions = async (
        token: string,
        executionType: "MARKET" | "TWAP" = "MARKET",
    ) => {
        try {
            const response = await fetch(
                "https://hl-v2.pearprotocol.io/positions/close-all",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        executionType,
                    }),
                },
            );

            const data = await response.json();
            console.log("Close all positions result:", data);
            await fetchPositions(token);
            return data;
        } catch (err) {
            console.error("Failed to close all positions:", err);
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to close all positions";
        }
    };

    const createPosition = async (token: string) => {
        isCreatingPosition = true;
        try {
            const requestBody = {
                slippage: newPositionForm.slippage,
                executionType: newPositionForm.executionType,
                leverage: newPositionForm.leverage,
                usdValue: newPositionForm.usdValue,
                longAssets: [{ asset: newPositionForm.longAsset, weight: 0.5 }],
                shortAssets: [
                    { asset: newPositionForm.shortAsset, weight: 0.5 },
                ],
            };
            console.log(
                "Creating position with:",
                JSON.stringify(requestBody, null, 2),
            );

            const response = await fetch(
                "https://hl-v2.pearprotocol.io/positions",
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                },
            );

            const responseText = await response.text();
            console.log("Raw response:", responseText);
            console.log("Response status:", response.status);
            const data = responseText ? JSON.parse(responseText) : {};
            console.log("Create position result:", data);
            if (data.orderId) {
                await fetchPositions(token);
            } else {
                error = data.message || "Failed to create position";
            }
            return data;
        } catch (err) {
            console.error("Failed to create position:", err);
            error =
                err instanceof Error
                    ? err.message
                    : "Failed to create position";
        } finally {
            isCreatingPosition = false;
        }
    };

    const formatPnl = (pnl: number): string => {
        const sign = pnl >= 0 ? "+" : "";
        return `${sign}$${pnl.toFixed(2)}`;
    };

    const formatPnlPercentage = (pnlPct: number): string => {
        const sign = pnlPct >= 0 ? "+" : "";
        return `${sign}${pnlPct.toFixed(2)}%`;
    };
</script>

{#if session}
    <div>
        <p><strong>Wallet:</strong> {session.walletAddress}</p>
        <p><strong>Agent Wallet:</strong> {session.agentWalletAddress}</p>
        <p>
            <strong>Agent Approved:</strong>
            {session.isAgentApproved ? "Yes" : "No"}
        </p>
        {#if !session.isAgentApproved}
            <button onclick={getAddress}>Retry Approve Agent</button>
        {/if}
        <p>
            <strong>Builder Approved:</strong>
            {builderApproved ? "Yes" : "No"}
            (current rate: {currentBuilderFeeRate ?? "none"}, required: {REQUIRED_FEE_RATE})
        </p>
        {#if !builderApproved}
            <button
                onclick={() => approveBuilder(session.walletAddress)}
                disabled={isApprovingBuilder}
            >
                {isApprovingBuilder ? "Approving..." : "Approve Pear Builder"}
            </button>
        {/if}
        <button onclick={clearSession}>Disconnect</button>
    </div>
    <div>
        <p><strong>Orders ({orders.length}):</strong></p>
        {#if orders.length === 0}
            <p>No open orders</p>
        {:else}
            {#each orders as order}
                <p>
                    <strong>ID:</strong>
                    {order.id}
                    <strong>Asset:</strong>
                    {order.asset}
                    <strong>Amount:</strong>
                    {order.amount}
                    <strong>Price:</strong>
                    {order.price}
                </p>
            {/each}
        {/if}
        <button onclick={() => fetchOrders(session?.accessToken ?? "")}
            >Refresh Orders</button
        >
        <button
            onclick={async () => {
                if (session?.accessToken) {
                    await spotOrder(session.accessToken);
                    await fetchOrders(session.accessToken);
                }
            }}>Open simple spot</button
        >
    </div>
    <div
        style="border: 1px solid #666; padding: 15px; margin: 10px 0; border-radius: 5px;"
    >
        <p><strong>Open New Position</strong></p>
        <div
            style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;"
        >
            <label>
                Long:
                <input
                    type="text"
                    bind:value={newPositionForm.longAsset}
                    placeholder="BTC"
                    style="width: 80px;"
                />
            </label>
            <label>
                Short:
                <input
                    type="text"
                    bind:value={newPositionForm.shortAsset}
                    placeholder="ETH"
                    style="width: 80px;"
                />
            </label>
            <label>
                USD Value:
                <input
                    type="number"
                    bind:value={newPositionForm.usdValue}
                    min="1"
                    style="width: 80px;"
                />
            </label>
            <label>
                Leverage:
                <input
                    type="number"
                    bind:value={newPositionForm.leverage}
                    min="1"
                    max="100"
                    style="width: 60px;"
                />
            </label>
            <label>
                Slippage:
                <select bind:value={newPositionForm.slippage}>
                    <option value={0.005}>0.5%</option>
                    <option value={0.01}>1%</option>
                    <option value={0.02}>2%</option>
                    <option value={0.05}>5%</option>
                </select>
            </label>
            <label>
                Type:
                <select bind:value={newPositionForm.executionType}>
                    <option value="SYNC">Sync</option>
                    <option value="MARKET">Market</option>
                    <option value="TWAP">TWAP</option>
                </select>
            </label>
            <button
                onclick={() => createPosition(session?.accessToken ?? "")}
                disabled={isCreatingPosition}
            >
                {isCreatingPosition ? "Opening..." : "Open Position"}
            </button>
        </div>
    </div>
    <div>
        <p><strong>Positions ({positions.length}):</strong></p>
        {#if positions.length === 0}
            <p>No open positions</p>
        {:else}
            {#each positions as position}
                <div
                    style="border: 1px solid #ccc; padding: 10px; margin: 10px 0; border-radius: 5px;"
                >
                    <p>
                        <strong>Position ID:</strong>
                        {position.positionId.slice(0, 8)}...
                    </p>
                    <p>
                        <strong>Long:</strong>
                        {position.longAssets
                            .map(
                                (a) => `${a.coin} (${a.actualSize.toFixed(4)})`,
                            )
                            .join(", ") || "None"}
                    </p>
                    <p>
                        <strong>Short:</strong>
                        {position.shortAssets
                            .map(
                                (a) => `${a.coin} (${a.actualSize.toFixed(4)})`,
                            )
                            .join(", ") || "None"}
                    </p>
                    <p>
                        <strong>Position Value:</strong>
                        ${position.positionValue.toFixed(2)}
                        <strong style="margin-left: 10px;">Margin Used:</strong>
                        ${position.marginUsed.toFixed(2)}
                    </p>
                    <p>
                        <strong>Unrealized PnL:</strong>
                        <span
                            style="color: {position.unrealizedPnl >= 0
                                ? 'green'
                                : 'red'}"
                        >
                            {formatPnl(position.unrealizedPnl)} ({formatPnlPercentage(
                                position.unrealizedPnlPercentage,
                            )})
                        </span>
                    </p>
                    <p>
                        <strong>Entry Ratio:</strong>
                        {position.entryRatio.toFixed(4)}
                        <strong style="margin-left: 10px;">Mark Ratio:</strong>
                        {position.markRatio.toFixed(4)}
                    </p>
                    {#if position.stopLoss}
                        <p>
                            <strong>Stop Loss:</strong>
                            {position.stopLoss.type} @ {position.stopLoss.value}
                            {position.stopLoss.isTrailing ? "(Trailing)" : ""}
                        </p>
                    {/if}
                    {#if position.takeProfit}
                        <p>
                            <strong>Take Profit:</strong>
                            {position.takeProfit.type} @ {position.takeProfit
                                .value}
                            {position.takeProfit.isTrailing ? "(Trailing)" : ""}
                        </p>
                    {/if}
                    <p>
                        <strong>Created:</strong>
                        {new Date(position.createdAt).toLocaleString()}
                    </p>
                    <button
                        onclick={() =>
                            closePosition(
                                session?.accessToken ?? "",
                                position.positionId,
                            )}
                        disabled={closingPositionId === position.positionId}
                    >
                        {closingPositionId === position.positionId
                            ? "Closing..."
                            : "Close Position (Market)"}
                    </button>
                </div>
            {/each}
        {/if}
        <button onclick={() => fetchPositions(session?.accessToken ?? "")}
            >Refresh Positions</button
        >
        {#if positions.length > 0}
            <button
                onclick={() => closeAllPositions(session?.accessToken ?? "")}
                >Close All Positions</button
            >
        {/if}
    </div>
{:else}
    <button onclick={getAddress}>Connect & Create Agent</button>
{/if}
<p>{error}</p>
