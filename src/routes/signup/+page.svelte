<script lang="ts">
	import { Button } from "$lib/components/ui/button";
	import * as Card from "$lib/components/ui/card";
	import { Input } from "$lib/components/ui/input";
	import { Label } from "$lib/components/ui/label";
	import { goto } from '$app/navigation';
	import pearPoolLogo from "$lib/assets/logo-no-bg.jpg";

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let isLoading = $state(false);
	let error = $state('');

	async function handleSignup(event: SubmitEvent) {
		event.preventDefault();
		error = '';

		if (password !== confirmPassword) {
			error = 'Passwords do not match';
			return;
		}

		if (password.length < 6) {
			error = 'Password must be at least 6 characters';
			return;
		}

		isLoading = true;

		try {
			// TODO: Add actual signup logic here
			console.log('Signing up:', { name, email });
			
			await goto('/lobby');
		} catch (err) {
			console.error('Signup failed:', err);
			error = err instanceof Error ? err.message : 'Signup failed. Please try again.';
		} finally {
			isLoading = false;
		}
	}
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
				<Button variant="ghost" href="/">Back to Login</Button>
			</nav>
		</div>
	</header>

	<main class="flex-1 flex items-center justify-center p-4">
	<div class="w-full max-w-md space-y-4">
		
		<Card.Root>
			<Card.Header>
				<Card.Title>Create an account</Card.Title>
				<Card.Description>
					Enter your details below to create your account
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<form onsubmit={handleSignup}>
					<div class="flex flex-col gap-6">
						{#if error}
							<div class="p-3 text-sm text-red-500 bg-red-50 dark:bg-red-950 rounded-md">
								{error}
							</div>
						{/if}
						<div class="grid gap-2">
							<Label for="name">Name</Label>
							<Input
								id="name"
								type="text"
								placeholder="Your name"
								required
								bind:value={name}
							/>
						</div>
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
						<div class="grid gap-2">
							<Label for="confirm-password">Confirm Password</Label>
							<Input id="confirm-password" type="password" required bind:value={confirmPassword} />
						</div>
						<Button type="submit" class="w-full" disabled={isLoading}>
							{isLoading ? 'Creating account...' : 'Sign Up'}
						</Button>
					</div>
				</form>
			</Card.Content>
			<Card.Footer class="flex-col gap-2">
				<p class="text-sm text-muted-foreground">
					Already have an account? <Button variant="link" href="/" class="p-0 h-auto">Login</Button>
				</p>
			</Card.Footer>
		</Card.Root>
	</div>
	</main>
</div>
