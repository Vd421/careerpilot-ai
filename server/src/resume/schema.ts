import { z } from "zod";

// A single resume bullet. The id is what makes "never invent experience"
// checkable: tailored bullets must point back to an id that exists here.
const bulletSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

const linkSchema = z.object({
  label: z.string().min(1),
  url: z.url(),
});

const educationSchema = z.object({
  school: z.string().min(1),
  degree: z.string().min(1),
  location: z.string().optional(),
  start: z.string().optional(),
  end: z.string().min(1),
  details: z.array(z.string()).optional(),
});

const experienceSchema = z.object({
  id: z.string().min(1),
  company: z.string().min(1),
  role: z.string().min(1),
  location: z.string().optional(),
  start: z.string().min(1),
  end: z.string().nullable(), // null = current job
  bullets: z.array(bulletSchema).min(1),
});

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tech: z.array(z.string()),
  link: z.url().optional(),
  bullets: z.array(bulletSchema).min(1),
});

const skillGroupSchema = z.object({
  category: z.string().min(1),
  items: z.array(z.string().min(1)).min(1),
});

export const resumeSchema = z.object({
  basics: z.object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().optional(),
    location: z.string().optional(),
    links: z.array(linkSchema),
  }),
  education: z.array(educationSchema),
  experience: z.array(experienceSchema),
  projects: z.array(projectSchema),
  skills: z.array(skillGroupSchema).min(1),
  interests: z.array(z.string()).optional(),
});

// The TypeScript type comes FROM the schema, so the two can never drift apart.
export type Resume = z.infer<typeof resumeSchema>;
