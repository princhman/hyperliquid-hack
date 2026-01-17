<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import pearPoolLogo from "$lib/assets/logo-no-bg.jpg";
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-between">
			<div class="flex items-center">
				<img src={pearPoolLogo} alt="Pear Pool Logo" class="h-12 w-12 mr-3 object-contain" />
				<h1 class="text-2xl font-bold leading-none">
					<a href="/">Pear Pool</a>
				</h1>
			</div>
			<nav class="flex gap-4">
				<Button variant="ghost" href="/how-it-works">How it Works</Button>
				<Button variant="ghost" href="/lobby">Lobby</Button>
				<Button variant="ghost" href="/profile">Profile</Button>
				<Button variant="outline" href="/">Logout</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12">
		<div class="space-y-8">
			<div class="flex items-center justify-between">
				<h2 class="text-3xl font-bold tracking-tight">Game Lobby</h2>
				<Button>Create New Game</Button>
			</div>

			<div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
				<!-- Active Game Card -->
				<Card.Root>
					<Card.Header>
						<Card.Title>BTC vs ETH Showdown</Card.Title>
						<Card.Description>Started 2 hours ago</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Players</span>
								<span class="font-medium">8/10</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Prize Pool</span>
								<span class="font-medium text-green-500">$5,000</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Time Left</span>
								<span class="font-medium">4h 32m</span>
							</div>
						</div>
					</Card.Content>
					<Card.Footer>
						<Button class="w-full">Join Game</Button>
					</Card.Footer>
				</Card.Root>

				<!-- Another Game Card -->
				<Card.Root>
					<Card.Header>
						<Card.Title>SOL vs AVAX Battle</Card.Title>
						<Card.Description>Starting in 30 minutes</Card.Description>
					</Card.Header>
					<Card.Content>
						<div class="space-y-2 text-sm">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Players</span>
								<span class="font-medium">3/10</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Prize Pool</span>
								<span class="font-medium text-green-500">$2,500</span>
							</div>
							<div class="flex justify-between">
								<span class="text-muted-foreground">Duration</span>
								<span class="font-medium">6 hours</span>
							</div>
						</div>
					</Card.Content>
					<Card.Footer>
						<Button class="w-full" variant="outline">Join Waiting Room</Button>
					</Card.Footer>
				</Card.Root>

				<!-- Create Game Card -->
				<Card.Root class="border-dashed">
					<Card.Header>
						<Card.Title>Create New Game</Card.Title>
						<Card.Description>Set up your own trading competition</Card.Description>
					</Card.Header>
					<Card.Content>
						<p class="text-sm text-muted-foreground">
							Choose your pairs, set the prize pool, and invite friends to compete.
						</p>
					</Card.Content>
					<Card.Footer>
						<Button class="w-full" variant="secondary">+ Create Game</Button>
					</Card.Footer>
				</Card.Root>
			</div>

			<!-- Leaderboard Section -->
			<div class="mt-12">
				<h3 class="text-2xl font-bold mb-4">Top Traders This Week</h3>
				<Card.Root>
					<Card.Content class="p-0">
						<div class="divide-y">
							<div class="flex items-center justify-between p-4">
								<div class="flex items-center gap-3">
									<span class="text-2xl">🥇</span>
									<span class="font-medium">trader_alpha</span>
								</div>
								<span class="text-green-500 font-medium">+$12,450</span>
							</div>
							<div class="flex items-center justify-between p-4">
								<div class="flex items-center gap-3">
									<span class="text-2xl">🥈</span>
									<span class="font-medium">crypto_king</span>
								</div>
								<span class="text-green-500 font-medium">+$8,230</span>
							</div>
							<div class="flex items-center justify-between p-4">
								<div class="flex items-center gap-3">
									<span class="text-2xl">🥉</span>
									<span class="font-medium">pair_master</span>
								</div>
								<span class="text-green-500 font-medium">+$5,120</span>
							</div>
						</div>
					</Card.Content>
				</Card.Root>
			</div>
		</div>
	</main>
</div>
