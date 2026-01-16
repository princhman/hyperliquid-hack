import { createConfig, http } from "@wagmi/core";
import { mainnet, arbitrum } from "@wagmi/core/chains";
import { injected, walletConnect } from "@wagmi/connectors";

// WalletConnect project ID - you should get your own at https://cloud.walletconnect.com
const WALLET_CONNECT_PROJECT_ID = "YOUR_PROJECT_ID";

export const config = createConfig({
  chains: [mainnet, arbitrum],
  connectors: [
    injected(),
    walletConnect({
      projectId: WALLET_CONNECT_PROJECT_ID,
      metadata: {
        name: "Pear Pool",
        description: "Competitive pair-trading game",
        url: "https://hyperliquid-hack.vercel.app",
        icons: [],
      },
    }),
  ],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
  },
});
