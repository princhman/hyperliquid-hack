import { writable } from "svelte/store";

export interface User {
  id: string;
  walletAddress: string;
  username?: string;
}

function createAuthStore() {
  const { subscribe, set, update } = writable<User | null>(null);

  return {
    subscribe,
    login: (user: User) => set(user),
    logout: () => {
      set(null);
      if (typeof window !== "undefined") {
        localStorage.removeItem("walletAddress");
      }
    },
    setFromStorage: () => {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("walletAddress");
        if (stored) {
          return stored;
        }
      }
      return null;
    },
    persistWallet: (address: string) => {
      if (typeof window !== "undefined") {
        localStorage.setItem("walletAddress", address.toLowerCase());
      }
    },
  };
}

export const auth = createAuthStore();
