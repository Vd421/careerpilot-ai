// Location check against a Loop's `locations` (e.g. ["Remote"], ["India", "Bengaluru", "Remote"]).
// Company boards (Greenhouse/Lever/Ashby) return EVERY job a company has, so without this a
// "Remote" loop fills up with San Francisco on-site roles and "Remote - US only" roles.

export interface LocationVerdict {
  drop: string | null;
  tag: string | null; // "location_unknown" when the job doesn't say
}

const REMOTE_WORDS = /\b(remote|anywhere|worldwide|global|distributed|work from home|wfh)\b/i;
// Remote with no country limit (or a limit that includes India)
const OPEN_REMOTE = /\b(anywhere|worldwide|global|apac|asia|india)\b/i;
// Words that say nothing about a place
const FILLER = /\b(remote|hybrid|flexible|first|friendly|optional|only|or|and|based|n\/a|na|tbd|-)\b|[()•,/|–—-]/gi;

// A loop location also matches common names for places inside it.
const ALIASES: Record<string, string[]> = {
  india: [
    "india", "bengaluru", "bangalore", "mumbai", "pune", "hyderabad", "chennai", "gurugram", "gurgaon",
    "noida", "delhi", "new delhi", "ncr", "kolkata", "ahmedabad", "kochi", "jaipur", "indore", "chandigarh",
  ],
  bengaluru: ["bengaluru", "bangalore"],
  bangalore: ["bengaluru", "bangalore"],
  gurugram: ["gurugram", "gurgaon"],
};

function placesFor(loc: string): string[] {
  const l = loc.trim().toLowerCase();
  return ALIASES[l] ?? [l];
}

function mentions(text: string, place: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${place.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "iu").test(text);
}

export function checkLocation(
  location: string | null,
  remote: boolean | null,
  loopLocations: string[] | undefined,
): LocationVerdict {
  const wanted = (loopLocations ?? []).map((l) => l.trim()).filter(Boolean);
  if (wanted.length === 0) return { drop: null, tag: null };

  const text = (location ?? "").trim();
  if (!text || /^(n\/a|na|tbd|-)$/i.test(text)) {
    return { drop: null, tag: remote === true ? null : "location_unknown" };
  }

  const wantsRemote = wanted.some((l) => REMOTE_WORDS.test(l));
  const places = wanted.filter((l) => !REMOTE_WORDS.test(l)).flatMap(placesFor);

  // 1. It names one of my places (e.g. "Bengaluru", "Remote - India")
  if (places.some((p) => mentions(text, p))) return { drop: null, tag: null };

  const isRemote = remote === true || REMOTE_WORDS.test(text);
  if (wantsRemote && isRemote) {
    // 2. Remote with no region, or a region that includes me
    if (OPEN_REMOTE.test(text)) return { drop: null, tag: null };
    const leftover = text.replace(FILLER, " ").replace(/\s+/g, " ").trim();
    if (!leftover) return { drop: null, tag: null };
    // 3. "Remote - United States", or remote flag + "San Francisco": remote only inside that region
    return { drop: `Remote only in ${text}`, tag: null };
  }

  return { drop: `Location "${text}" is not in this loop's locations`, tag: null };
}
