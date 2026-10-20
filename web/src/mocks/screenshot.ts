// In mock mode there are no real screenshots, so draw a believable filled form as an SVG data URI.
export function mockScreenshot(seed: string): string {
  const n = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const rows = Array.from({ length: 6 }, (_, i) => {
    const y = 150 + i * 62;
    const w = 300 + ((n + i * 37) % 160);
    return `<rect x="80" y="${y}" width="150" height="9" rx="4" fill="#cfccc3"/><rect x="80" y="${y + 18}" width="560" height="30" rx="6" fill="#fff" stroke="#dcd9d0"/><rect x="92" y="${y + 29}" width="${w}" height="8" rx="4" fill="#8f8c83"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="560" viewBox="0 0 720 560"><rect width="720" height="560" fill="#f7f6f2"/><rect width="720" height="56" fill="#fff"/><rect x="80" y="20" width="110" height="14" rx="4" fill="#2f6f6b"/><rect x="80" y="84" width="260" height="18" rx="5" fill="#1f1e1b"/><rect x="80" y="112" width="380" height="9" rx="4" fill="#b7b4aa"/>${rows}<rect x="80" y="${150 + 6 * 62}" width="132" height="34" rx="8" fill="#2f6f6b" opacity=".35"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
