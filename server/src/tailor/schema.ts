import { z } from "zod";
import type { TailoredResume } from "../contracts.js";

// Shape of the model's answer. Mirrors TailoredResume in contracts.ts (the compile-time check below keeps them in sync).
export const tailoredResumeSchema = z.object({
  headline: z.string().nullable(),
  sections: z.array(
    z.object({
      sourceId: z.string(),
      bullets: z.array(z.object({ sourceBulletId: z.string(), text: z.string() })),
    }),
  ),
  skillsOrder: z.array(z.string()),
  coverNote: z.string().nullable(),
});

type _InSync = z.infer<typeof tailoredResumeSchema> extends TailoredResume ? true : never;
const _check: _InSync = true;
void _check;
