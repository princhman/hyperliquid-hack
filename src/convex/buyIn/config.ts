import { createConfig, http } from "@wagmi/core";
import { arbitrum, mainnet, base } from "viem/chains";
import { injected } from "@wagmi/connectors";

export const config = createConfig({
  chains: [arbitrum, mainnet, base],
  connectors: [injected()],  // MetaMask, etc.
  transports: {
    [arbitrum.id]: http(),
    [mainnet.id]: http(),
    [base.id]: http(),
  },
});