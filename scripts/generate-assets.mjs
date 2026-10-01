// Pulls real data from GitHub's GraphQL API and renders self-hosted SVG
// replacements for the third-party stats/streak/contribution-graph badges,
// all styled to match the README's purple/dark theme.
import { writeFile } from "node:fs/promises";

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GRAPHQL_TOKEN;

if (!USERNAME || !TOKEN) {
  throw new Error("GH_USERNAME and GRAPHQL_TOKEN env vars are required");
}

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      pullRequests { totalCount }
      issues { totalCount }
      repositories(ownerAffiliations: OWNER, isFork: false, first: 100) {
        totalCount
        nodes {
          stargazerCount
          languages(first: 5, orderBy: { field: SIZE, direction: DESC }) {
            edges {
              size
              node { name color }
            }
          }
        }
      }
      contributionsCollection {
        totalCommitContributions
        totalRepositoriesWithContributedCommits
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays { date contributionCount }
          }
        }
      }
    }
  }
`;

const res = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `bearer ${TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
});

if (!res.ok) {
  throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
}

const json = await res.json();
if (json.errors) {
  throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
}

const user = json.data.user;
const calendar = user.contributionsCollection.contributionCalendar;
const weeks = calendar.weeks;
const days = weeks.flatMap((w) => w.contributionDays);

const CARD_BG = "#151515";
const ACCENT = "#7C3AED";
const TEXT_MUTED = "#9f9f9f";
const STYLE = `
  text { font-family: 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9c9c9; }
  .title { font-size: 16px; font-weight: 600; fill: #ffffff; }
  .label { font-size: 13px; fill: ${TEXT_MUTED}; }
  .value { font-size: 13px; font-weight: 700; fill: #ffffff; }
  .big { font-size: 28px; font-weight: 700; fill: #ffffff; }
  .small { font-size: 11px; fill: ${TEXT_MUTED}; }
`;

function cardWrap(width, height, body) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>${STYLE}</style>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${CARD_BG}" stroke="#2a2a2a"/>
  ${body}
</svg>`;
}

// ---- Stats card ----
const totalStars = user.repositories.nodes.reduce((sum, r) => sum + r.stargazerCount, 0);
const statsRows = [
  ["Total Stars Earned", totalStars],
  ["Total Commits (last year)", user.contributionsCollection.totalCommitContributions],
  ["Total PRs", user.pullRequests.totalCount],
  ["Total Issues", user.issues.totalCount],
  ["Contributed to (last year)", user.contributionsCollection.totalRepositoriesWithContributedCommits],
];
const statsBody = `
  <text x="25" y="35" class="title">${escapeXml(USERNAME)}'s GitHub Stats</text>
  ${statsRows
    .map(
      (
        [label, value],
        i
      ) => `<text x="25" y="${70 + i * 28}" class="label">${label}:</text><text x="300" y="${70 + i * 28}" class="value" text-anchor="end">${value}</text>`
    )
    .join("\n  ")}
`;
await writeFile("assets/stats.svg", cardWrap(340, 70 + statsRows.length * 28 + 15, statsBody), "utf8");

// ---- Streak card ----
function toUTCDate(s) {
  return new Date(`${s}T00:00:00Z`);
}
const sortedDays = [...days].sort((a, b) => toUTCDate(a.date) - toUTCDate(b.date));

let longest = 0;
let longestRange = [null, null];
let run = 0;
let runStart = null;
for (const d of sortedDays) {
  if (d.contributionCount > 0) {
    if (run === 0) runStart = d.date;
    run += 1;
    if (run > longest) {
      longest = run;
      longestRange = [runStart, d.date];
    }
  } else {
    run = 0;
  }
}

let current = 0;
let currentEnd = null;
for (let i = sortedDays.length - 1; i >= 0; i--) {
  if (sortedDays[i].contributionCount > 0) {
    if (current === 0) currentEnd = sortedDays[i].date;
    current += 1;
  } else {
    break;
  }
}

const fmt = (s) =>
  s ? toUTCDate(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";

const rangeStart = sortedDays[0]?.date;
const rangeEnd = sortedDays[sortedDays.length - 1]?.date;

const streakBody = `
  <line x1="200" y1="20" x2="200" y2="140" stroke="#2a2a2a"/>
  <line x1="400" y1="20" x2="400" y2="140" stroke="#2a2a2a"/>

  <text x="100" y="60" class="big" text-anchor="middle">${calendar.totalContributions}</text>
  <text x="100" y="85" class="label" text-anchor="middle">Total Contributions</text>
  <text x="100" y="105" class="small" text-anchor="middle">${fmt(rangeStart)} - Present</text>

  <text x="300" y="60" class="big" text-anchor="middle" fill="${ACCENT}">${current}</text>
  <text x="300" y="85" class="label" text-anchor="middle">Current Streak</text>
  <text x="300" y="105" class="small" text-anchor="middle">${fmt(currentEnd) || "-"}</text>

  <text x="500" y="60" class="big" text-anchor="middle">${longest}</text>
  <text x="500" y="85" class="label" text-anchor="middle">Longest Streak</text>
  <text x="500" y="105" class="small" text-anchor="middle">${fmt(longestRange[0])} - ${fmt(longestRange[1])}</text>
`;
await writeFile("assets/streak.svg", cardWrap(600, 150, streakBody), "utf8");

// ---- Top languages card ----
const langTotals = new Map();
for (const repo of user.repositories.nodes) {
  for (const edge of repo.languages.edges) {
    const key = edge.node.name;
    const entry = langTotals.get(key) || { size: 0, color: edge.node.color || "#858585" };
    entry.size += edge.size;
    langTotals.set(key, entry);
  }
}
const totalSize = [...langTotals.values()].reduce((sum, v) => sum + v.size, 0) || 1;
const topLangs = [...langTotals.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, 6)
  .map(([name, v]) => ({ name, pct: (v.size / totalSize) * 100, color: v.color }));

let barX = 25;
const barY = 55;
const barWidth = 290;
const barHeight = 10;
let bars = "";
for (const lang of topLangs) {
  const w = (lang.pct / 100) * barWidth;
  bars += `<rect x="${barX}" y="${barY}" width="${w}" height="${barHeight}" fill="${lang.color}"/>`;
  barX += w;
}
const legend = topLangs
  .map(
    (lang, i) =>
      `<circle cx="30" cy="${85 + i * 20}" r="4" fill="${lang.color}"/><text x="42" y="${89 + i * 20}" class="label">${lang.name} ${lang.pct.toFixed(2)}%</text>`
  )
  .join("\n  ");
const langsBody = `
  <text x="25" y="30" class="title">Most Used Languages</text>
  <rect x="25" y="55" width="${barWidth}" height="${barHeight}" rx="5" fill="#2a2a2a"/>
  ${bars}
  ${legend}
`;
await writeFile("assets/top-langs.svg", cardWrap(340, 95 + topLangs.length * 20, langsBody), "utf8");

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}

// ---- Contribution graph ----
const maxCount = Math.max(1, ...days.map((d) => d.contributionCount));
const LEVEL_COLORS = ["#1b1033", "#4c2889", "#6c35c3", "#9456e8", "#c08af5"];
function levelFor(count) {
  if (count === 0) return 0;
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

const CELL = 11;
const GAP = 3;
const LEFT_PAD = 28;
const TOP_PAD = 36;
const gWidth = LEFT_PAD + weeks.length * (CELL + GAP);
const gHeight = TOP_PAD + 7 * (CELL + GAP) + 10;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

let cells = "";
let monthLabels = "";
let lastMonth = -1;
weeks.forEach((week, wi) => {
  const x = LEFT_PAD + wi * (CELL + GAP);
  const firstDay = toUTCDate(week.contributionDays[0].date);
  const month = firstDay.getUTCMonth();
  if (month !== lastMonth) {
    monthLabels += `<text x="${x}" y="${TOP_PAD - 10}" class="small">${MONTHS[month]}</text>`;
    lastMonth = month;
  }
  week.contributionDays.forEach((day, di) => {
    const y = TOP_PAD + di * (CELL + GAP);
    const level = levelFor(day.contributionCount);
    cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${LEVEL_COLORS[level]}"><title>${day.contributionCount} contributions on ${day.date}</title></rect>`;
  });
});
let dayLabels = "";
DAY_LABELS.forEach((label, di) => {
  if (!label) return;
  const y = TOP_PAD + di * (CELL + GAP) + CELL - 2;
  dayLabels += `<text x="0" y="${y}" class="small">${label}</text>`;
});
const graphBody = `
  <text x="${LEFT_PAD}" y="18" class="title" style="font-size:14px">${calendar.totalContributions} contributions in the last year</text>
  ${monthLabels}
  ${dayLabels}
  ${cells}
`;
await writeFile("assets/contribution-graph.svg", cardWrap(gWidth, gHeight, graphBody), "utf8");

console.log(
  `Generated assets: stats (${totalStars} stars, ${user.contributionsCollection.totalCommitContributions} commits), ` +
    `streak (current ${current}, longest ${longest}), top-langs (${topLangs.length} languages), ` +
    `contribution-graph (${calendar.totalContributions} total)`
);
