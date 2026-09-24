/**
 * Flags what an AI rewrite says that the original resume did not.
 *
 * The prompts forbid inventing metrics and tools, but a prompt is a request, not
 * a guarantee — and an invented "cut load time 40%" is exactly the line an
 * interviewer asks about. This compares the two texts deterministically and
 * lists every number and technology that appears only in the rewrite, so each
 * one is confirmed by a person before it is accepted.
 */

/**
 * Technologies worth checking. Deliberately a fixed list rather than "any
 * capitalised word": names, companies and section headers would drown the real
 * signal in noise.
 */
const TECH_TERMS = [
  "React", "React Native", "Redux", "Redux Toolkit", "Zustand", "MobX", "Next.js", "Remix", "Gatsby",
  "Vue", "Nuxt", "Angular", "Svelte", "SolidJS", "TypeScript", "JavaScript", "HTML", "CSS", "Sass",
  "SCSS", "Less", "Tailwind", "Bootstrap", "Material UI", "MUI", "Chakra", "styled-components",
  "Emotion", "Storybook", "Webpack", "Vite", "Rollup", "Babel", "ESLint", "Prettier", "Jest",
  "Vitest", "Cypress", "Playwright", "Testing Library", "Enzyme", "Mocha", "Node.js", "Express",
  "NestJS", "Fastify", "Deno", "Bun", "GraphQL", "Apollo", "REST", "gRPC", "WebSocket", "Socket.io",
  "tRPC", "React Query", "TanStack", "SWR", "Axios", "MongoDB", "PostgreSQL", "MySQL", "Redis",
  "Firebase", "Supabase", "Prisma", "Sequelize", "DynamoDB", "Elasticsearch", "AWS", "Azure", "GCP",
  "Vercel", "Netlify", "Docker", "Kubernetes", "Terraform", "CI/CD", "GitHub Actions", "Jenkins",
  "Python", "Django", "Flask", "Java", "Spring", "Go", "Rust", "C#", ".NET", "PHP", "Laravel",
  "Figma", "D3", "Three.js", "WebGL", "Chart.js", "Highcharts", "PWA", "Service Worker",
  "Web Vitals", "Lighthouse", "SEO", "Accessibility", "WCAG", "i18n", "Micro-frontends",
  "Module Federation", "Monorepo", "Nx", "Turborepo", "Electron", "Flutter", "Kotlin", "Swift",
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function mentions(text: string, term: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9+#.])${escapeRe(term)}($|[^A-Za-z0-9+#])`, "i").test(text);
}

/** "40%", "200+", "1.3MB", "3x", "₹12 LPA", "2,000" — the forms metrics take. */
const METRIC_RE = /(?:₹|\$)?\d[\d,]*(?:\.\d+)?\s?(?:%|\+|x\b|k\b|m\b|mb\b|kb\b|ms\b|s\b|lpa\b|users\b|hours?\b|days?\b|weeks?\b|months?\b)?/gi;

function metrics(text: string): string[] {
  return (text.match(METRIC_RE) || [])
    .map((m) => m.trim())
    // Bare small integers are usually list numbering or years in dates; skip.
    .filter((m) => !/^\d{1,2}$/.test(m) && !/^(19|20)\d{2}$/.test(m));
}

const normalizeMetric = (m: string) => m.toLowerCase().replace(/[\s,]/g, "");

export interface ClaimReport {
  numbers: string[];
  technologies: string[];
}

export function newClaims(source: string, output: string): ClaimReport {
  const known = new Set(metrics(source).map(normalizeMetric));
  const numbers = Array.from(
    new Set(metrics(output).filter((m) => !known.has(normalizeMetric(m))))
  ).slice(0, 12);
  const technologies = TECH_TERMS.filter((t) => mentions(output, t) && !mentions(source, t));
  return { numbers, technologies };
}

export function describeClaims(r: ClaimReport): string {
  const parts: string[] = [];
  if (r.numbers.length) parts.push(`numbers ${r.numbers.join(", ")}`);
  if (r.technologies.length) parts.push(`technologies ${r.technologies.join(", ")}`);
  return parts.join("; and ");
}

/** Unresolved "[confirm …]" markers in text that is about to leave the app. */
export function confirmMarkers(text: string): number {
  return (text.match(/\[confirm[^\]]*\]/gi) || []).length;
}
