This project is a competitive pair-trading game built on top of Pear Protocol and Hyperliquid. It lets multiple players start with the same notional capital, trade real markets via Pear’s pair-trading API, and compete to achieve the highest profit within a session. At the end of each game, the top-performing trader wins and takes a predefined share of the total “bank,” according to rules configured in the app.

The app uses a modern, mobile-friendly web frontend (e.g. SvelteKit) that focuses on a smooth trading and leaderboard experience. Users authenticate into the app, connect a trading wallet, and then join or create game sessions. Trading itself is executed through Pear Protocol, which manages Hyperliquid integration, including agent wallets, order routing, and PnL calculation, so the app can concentrate on game logic and user experience rather than low-level exchange details.

On the backend, the project maintains game state such as players, sessions, banks, and leaderboards in a database (for example, a real-time backend like Convex). The backend coordinates Pear authentication, manages each player’s agent wallet, opens and closes pair positions based on session rules, and periodically reads positions and trade history to compute live and final PnL. This architecture cleanly separates execution (Pear/Hyperliquid) from gameplay (this app), enabling a fast 48-hour MVP that can be extended later with richer tournaments, seasons, and native mobile clients.


# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project in the current directory
npx sv create

# create a new project in my-app
npx sv create my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
