import { createConfig, http, connect, disconnect } from "@wagmi/core";
import { arbitrum, mainnet, base } from "viem/chains";
import { injected } from "@wagmi/connectors";

export const config = createConfig({
    chains: [arbitrum, mainnet, base],
    connectors: [injected()],
    transports: {
        [arbitrum.id]: http(),
        [mainnet.id]: http(),
        [base.id]: http(),
    },
});

// Helper to connect wallet through wagmi
export async function connectWagmi() {
    const result = await connect(config, { connector: injected() });
    return result;
}

// Helper to disconnect
export async function disconnectWagmi() {
    await disconnect(config);
}