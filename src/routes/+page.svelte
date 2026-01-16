<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { goto } from '$app/navigation';

	let email = $state('');
	let password = $state('');
	let isLoading = $state(false);
	let error = $state('');

	async function handleLogin(event: SubmitEvent) {
		event.preventDefault();
		isLoading = true;
		error = '';

		try {
			// TODO: Add actual authentication logic here
			console.log('Logging in with:', email);
			
			// Navigate to lobby on successful login
			await goto('/lobby');
		} catch (err) {
			console.error('Login failed:', err);
			error = err instanceof Error ? err.message : 'Login failed. Please try again.';
		} finally {
			isLoading = false;
		}
	}
</script>

<div class="min-h-screen bg-background flex flex-col">
	<header class="border-b">
		<div class="container mx-auto px-4 py-4 flex items-center justify-between">
			<h1 class="text-2xl font-bold">
				<a href="/">Pear Pool</a>
			</h1>
			<nav class="flex gap-4">
				<Button variant="ghost" href="/how-it-works">How it Works</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 container mx-auto px-4 py-12 flex flex-col lg:flex-row items-center gap-12">
		<div class="flex-1 space-y-6">
			<h2 class="text-4xl lg:text-5xl font-bold tracking-tight">
				Compete. Trade. Win.
			</h2>
			<p class="text-xl text-muted-foreground max-w-lg">
				Join the ultimate trading duel. Start with equal capital, trade real markets via Hyperliquid, and climb the leaderboard to win the prize pool.
			</p>
			<div class="flex justify-start">
				<Button size="lg" variant="outline" href="/learn-more">Learn More</Button>
			</div>
		</div>

		<Card.Root class="w-full max-w-sm">
			<Card.Header>
				<Card.Title>Login to your account</Card.Title>
				<Card.Description>
					Enter your email below to login to your account
				</Card.Description>
				<Card.Action>
					<Button variant="link" href="/signup">Sign Up</Button>
				</Card.Action>
			</Card.Header>
			<Card.Content>
				<form onsubmit={handleLogin}>
					<div class="flex flex-col gap-6">
						{#if error}
							<div class="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md">
								{error}
							</div>
						{/if}
						<div class="grid gap-2">
							<Label for="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="m@example.com"
								required
								bind:value={email}
							/>
						</div>
						<div class="grid gap-2">
							<Label for="password">Password</Label>
							<Input id="password" type="password" required bind:value={password} />
						</div>
						<Button type="submit" class="w-full" disabled={isLoading}>
							{isLoading ? 'Logging in...' : 'Login'}
						</Button>
					</div>
				</form>
			</Card.Content>
			<Card.Footer class="flex-col gap-2">
			</Card.Footer>
		</Card.Root>
	</main>

	<footer class="border-t py-6">
		<div class="container mx-auto px-4 text-center text-muted-foreground">
			<p>Built with Pear Protocol & Hyperliquid</p>
		</div>
	</footer>
</div>
