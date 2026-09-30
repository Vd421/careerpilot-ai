import { z } from "zod";

// The exact shape we force Claude to answer in.
export const scoreSchema = z.object({
  matchScore: z.number().int().min(0).max(100),
  summary: z.string().min(1),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  redFlags: z.array(
    z.object({
      type: z.enum(["seniority", "location", "visa", "other"]),
      detail: z.string(),
    }),
  ),
});

export type Score = z.infer<typeof scoreSchema>;
