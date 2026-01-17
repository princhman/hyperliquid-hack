<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
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
			
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="max-w-3xl mx-auto space-y-8">
			<h2 class="text-4xl font-bold tracking-tight">How It Works</h2>
			
			<div class="grid gap-6">
				<Card.Root>
					<Card.Header>
						<Card.Title>1. Join a Game</Card.Title>
					</Card.Header>
					<Card.Content>
						<p class="text-muted-foreground">
							Connect your wallet and join an active trading competition. Everyone starts with the same notional capital.
						</p>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>2. Trade Pairs</Card.Title>
					</Card.Header>
					<Card.Content>
						<p class="text-muted-foreground">
							Execute pair trades on real markets via Hyperliquid. Go long on one asset while shorting another to profit from relative price movements.
						</p>
					</Card.Content>
				</Card.Root>

				<Card.Root>
					<Card.Header>
						<Card.Title>3. Win the Pool</Card.Title>
					</Card.Header>
					<Card.Content>
						<p class="text-muted-foreground">
							At the end of each game, the top-performing trader wins a share of the prize pool based on their PnL.
						</p>
					</Card.Content>
				</Card.Root>
			</div>

			<Button href="/" size="lg">Back to Home</Button>
		</div>
	</main>
</div>
