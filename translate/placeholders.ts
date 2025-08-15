// Placeholder patterns supported
const PLACEHOLDER_PATTERNS = [
  /\{\{\s*[^}]+\s*\}\}/g, // i18next {{var}}
  /\{\d+\}/g, // {0}, {1}
  /%(\d+\$)?[sd]/g, // %s, %d, %1$s
];

export function extractPlaceholders(s: string): string[] {
  return PLACEHOLDER_PATTERNS.flatMap((rx) => s.match(rx) ?? []);
}

export function placeholdersMatch(src: string, out: string): boolean {
  const A = extractPlaceholders(src).sort();
  const B = extractPlaceholders(out).sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}
