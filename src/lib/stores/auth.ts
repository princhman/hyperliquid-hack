import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface User {
  id: string;
  name: string;
  email: string;
  walletAddress?: string;
}

// Auth store
export const authToken = writable<string | null>(
  browser ? localStorage.getItem('authToken') : null
);

export const currentUser = writable<User | null>(null);

// Persist token to localStorage
if (browser) {
  authToken.subscribe((token) => {
    if (token) {
      localStorage.setItem('authToken', token);
    } else {
      localStorage.removeItem('authToken');
    }
  });
}

export function setAuth(token: string, user: User) {
  authToken.set(token);
  currentUser.set(user);
}

export function clearAuth() {
  authToken.set(null);
  currentUser.set(null);
}
