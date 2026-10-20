import type { Enqueue } from "../contracts.js";

// TEMPORARY STUB (B6 stage). B5 replaces this file with the real pg-boss queue.
export const enqueue: Enqueue = async () => {
  throw new Error("Queue is not started");
};

export async function syncLoopSchedules(): Promise<void> {}
export async function startQueue(): Promise<void> {}
export async function stopQueue(): Promise<void> {}
