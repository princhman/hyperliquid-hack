<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import pearPoolLogo from "$lib/assets/logo-bg-removebg-preview.png";
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-start gap-8">
			<div class="flex items-center">
				<img src={pearPoolLogo} alt="Pear Pool Logo" class="h-12 w-12 mr-1 object-contain" />
				<h1 class="text-xl font-light font-serif leading-none">
					<a href="/">Pear Pool</a>
				</h1>
			</div>
			<nav class="flex gap-4">
				<Button variant="ghost" href="/how-it-works">How it Works</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="max-w-3xl mx-auto space-y-8">
			<h2 class="text-4xl font-bold tracking-tight">About Pear Pool</h2>
			
			<div class="prose prose-lg dark:prose-invert">
				<p class="text-xl text-muted-foreground">
					Pear Pool is a competitive pair-trading game built on Pear Protocol and Hyperliquid. 
					It lets multiple players start with the same notional capital, trade real markets, 
					and compete to achieve the highest profit within a session.
				</p>

				<h3 class="text-2xl font-semibold mt-8">Why Pair Trading?</h3>
				<p class="text-muted-foreground">
					Pair trading is a market-neutral strategy that involves simultaneously going long 
					on one asset while shorting another related asset. This allows traders to profit 
					from the relative performance of the two assets, rather than the overall market direction.
				</p>

				<h3 class="text-2xl font-semibold mt-8">Powered by Hyperliquid</h3>
				<p class="text-muted-foreground">
					All trading is executed through Hyperliquid's high-performance perpetual futures 
					exchange, providing deep liquidity and fast execution for your trades.
				</p>
			</div>

			<div class="flex gap-4">
				<Button href="/" size="lg">Get Started</Button>
				<Button href="/how-it-works" size="lg" variant="outline">How it Works</Button>
			</div>
		</div>
	</main>
</div>
