<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { convex, api } from '$lib/convex';
	import { goto } from '$app/navigation';

	let isCreating = $state(false);
	let error = $state('');
	let success = $state('');

	// Form fields
	let name = $state('');
	let startDate = $state('');
	let startTime = $state('');
	let endDate = $state('');
	let endTime = $state('');
	let buyIn = $state('');

	async function createLobby() {
		error = '';
		success = '';

		// Validate fields
		if (!name.trim()) {
			error = 'Please enter a lobby name';
			return;
		}
		if (!startDate || !startTime) {
			error = 'Please select a start date and time';
			return;
		}
		if (!endDate || !endTime) {
			error = 'Please select an end date and time';
			return;
		}
		if (!buyIn || parseFloat(buyIn) <= 0) {
			error = 'Please enter a valid buy-in amount';
			return;
		}

		const walletAddress = localStorage.getItem('walletAddress');
		if (!walletAddress) {
			error = 'Please connect your wallet first';
			return;
		}

		// Convert to timestamps
		const startTimestamp = new Date(`${startDate}T${startTime}`).getTime();
		const endTimestamp = new Date(`${endDate}T${endTime}`).getTime();

		if (endTimestamp <= startTimestamp) {
			error = 'End time must be after start time';
			return;
		}

		isCreating = true;

		try {
			const result = await convex.mutation(api.lobby.createLobby, {
				name: name.trim(),
				walletAddress,
				startTime: startTimestamp,
				endTime: endTimestamp,
				buyIn: parseFloat(buyIn),
			});

			success = `Lobby "${result.name}" created successfully!`;
			console.log('Lobby created:', result);

			// Reset form
			name = '';
			startDate = '';
			startTime = '';
			endDate = '';
			endTime = '';
			buyIn = '';

			// Optionally redirect after a delay
			setTimeout(() => {
				goto('/');
			}, 1500);
		} catch (err) {
			// Extract clean error message from Convex error
			if (err instanceof Error) {
				const match = err.message.match(/Error: ([^]+?)(?:\s+at\s+|$)/);
				error = match ? match[1].trim() : err.message;
			} else {
				error = 'Failed to create lobby';
			}
			console.error('Create lobby error:', err);
		} finally {
			isCreating = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-background p-4">
	<Card.Root class="w-full max-w-md">
		<Card.Header class="space-y-1 text-center">
			<Card.Title class="text-2xl font-bold">Create Lobby</Card.Title>
			<Card.Description>Start a new trading competition</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			{#if error}
				<p class="text-sm text-destructive text-center">{error}</p>
			{/if}
			{#if success}
				<p class="text-sm text-green-600 text-center">{success}</p>
			{/if}

			<div class="space-y-2">
				<Label for="name">Lobby Name</Label>
				<Input
					id="name"
					type="text"
					placeholder="Enter lobby name"
					bind:value={name}
					maxlength={50}
				/>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="startDate">Start Date</Label>
					<Input id="startDate" type="date" bind:value={startDate} />
				</div>
				<div class="space-y-2">
					<Label for="startTime">Start Time</Label>
					<Input id="startTime" type="time" bind:value={startTime} />
				</div>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="endDate">End Date</Label>
					<Input id="endDate" type="date" bind:value={endDate} />
				</div>
				<div class="space-y-2">
					<Label for="endTime">End Time</Label>
					<Input id="endTime" type="time" bind:value={endTime} />
				</div>
			</div>

			<div class="space-y-2">
				<Label for="buyIn">Buy-in Amount (USD)</Label>
				<Input
					id="buyIn"
					type="number"
					placeholder="0.00"
					bind:value={buyIn}
					min="0"
					step="0.01"
				/>
			</div>

			<Button onclick={createLobby} class="w-full" disabled={isCreating}>
				{#if isCreating}
					Creating...
				{:else}
					Create Lobby
				{/if}
			</Button>
		</Card.Content>
		<Card.Footer class="text-center text-sm">
			<a href="/" class="text-muted-foreground hover:underline w-full block">
				← Back to Home
			</a>
		</Card.Footer>
	</Card.Root>
</div>
