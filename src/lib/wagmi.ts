import { createConfig, http } from "@wagmi/core";
import { mainnet, arbitrum, base } from "@wagmi/core/chains";
import { injected } from "@wagmi/connectors";
import { PUBLIC_RECIPIENT_ADDRESS } from "$env/static/public";

export const config = createConfig({
  chains: [arbitrum, mainnet, base],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
  },
});

// Default chain for payments
export const DEFAULT_CHAIN_ID = arbitrum.id;

// Treasury address to receive buy-ins
export const TREASURY_ADDRESS = PUBLIC_RECIPIENT_ADDRESS as unknown as `0x${string}`;
