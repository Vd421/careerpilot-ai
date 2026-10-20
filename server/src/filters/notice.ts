export interface NoticeVerdict {
  drop: string | null; // reason, when the JD needs someone sooner than my notice period
  risk: boolean; // soft hint ("immediate start preferred") that is not a hard requirement
}

const UNIT_DAYS: Record<string, number> = { day: 1, week: 7, month: 30 };

function toDays(n: number, unit: string): number {
  return n * (UNIT_DAYS[unit.replace(/s$/, "")] ?? 1);
}

export function checkNotice(description: string, noticeDays: number): NoticeVerdict {
  const t = description.toLowerCase();

  if (/\bimmediate(ly)?[\s-]+joiners?\b/.test(t)) {
    return { drop: "Wants an immediate joiner", risk: false };
  }

  // "join within 30 days", "joining in 2 weeks"
  for (const m of t.matchAll(/\bjoin(?:ing)?\s+(?:within|in)\s+(?:the\s+next\s+)?(\d+)(?:\s*[/-]\s*(\d+))?\s*(days?|weeks?|months?)/g)) {
    // "15/30 days" or "15-30 days": take the larger number (the most lenient reading)
    const n = Math.max(Number(m[1]), Number(m[2] ?? 0));
    const days = toDays(n, m[3]);
    if (days < noticeDays) {
      return { drop: `Wants joining within ${n} ${m[3]} (my notice is ${noticeDays} days)`, risk: false };
    }
  }

  // "notice period of max 30 days", "notice period up to 15 days", "max 30 days notice"
  const noticeRes = [
    /\bnotice(?:\s+period)?\s*(?:of\s+)?(?:max(?:imum)?|up\s*to|at\s+most|not\s+more\s+than)\s*(\d+)\s*(days?|weeks?|months?)/g,
    /\b(?:max(?:imum)?|up\s*to)\s*(\d+)\s*(days?|weeks?|months?)\s+notice/g,
  ];
  for (const re of noticeRes) {
    for (const m of t.matchAll(re)) {
      const days = toDays(Number(m[1]), m[2]);
      if (days < noticeDays) {
        return { drop: `Notice period capped at ${m[1]} ${m[2]} (mine is ${noticeDays} days)`, risk: false };
      }
    }
  }

  const risk = /\bimmediate(ly)?\s+(start|joining|availab)/.test(t) || /\basap\s+(start|joining)/.test(t);
  return { drop: null, risk };
}
