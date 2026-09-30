import Anthropic from "@anthropic-ai/sdk";

// All model names live here, so switching models is a one-line change.
export const MODELS = {
  cheap: "claude-haiku-4-5", // scoring / classification
} as const;

// Created on first use, not at import time: tests and the server
// can load this file without an API key as long as they never call Claude.
let client: Anthropic | undefined;

export function getClaude(): Anthropic {
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

// What every model call returns to our code: the answer + what it cost.
export interface ModelResult {
  output: unknown; // validated by the caller, never trusted as-is
  model: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: string | null;
}
