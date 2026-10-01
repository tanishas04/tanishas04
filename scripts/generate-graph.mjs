// Fetches the real GitHub contribution calendar via the GraphQL API and
// renders it as a purple-themed SVG heatmap, matching the README's color scheme.
import { writeFile } from "node:fs/promises";

const USERNAME = process.env.GH_USERNAME;
const TOKEN = process.env.GRAPHQL_TOKEN;

if (!USERNAME || !TOKEN) {
  throw new Error("GH_USERNAME and GRAPHQL_TOKEN env vars are required");
}

const QUERY = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
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

const calendar = json.data.user.contributionsCollection.contributionCalendar;
const weeks = calendar.weeks;
const total = calendar.totalContributions;

const maxCount = Math.max(1, ...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));

// Purple palette matching the README theme (base color #7C3AED).
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

const width = LEFT_PAD + weeks.length * (CELL + GAP);
const height = TOP_PAD + 7 * (CELL + GAP) + 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

let cells = "";
let monthLabels = "";
let lastMonth = -1;

weeks.forEach((week, wi) => {
  const x = LEFT_PAD + wi * (CELL + GAP);
  const firstDay = new Date(week.contributionDays[0].date);
  const month = firstDay.getMonth();
  if (month !== lastMonth) {
    monthLabels += `<text x="${x}" y="${TOP_PAD - 10}" class="month">${MONTHS[month]}</text>`;
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
  dayLabels += `<text x="0" y="${y}" class="day">${label}</text>`;
});

const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    text { font-family: 'Segoe UI', Ubuntu, Sans-Serif; fill: #c9c9c9; }
    .title { font-size: 14px; font-weight: 600; fill: #ffffff; }
    .month { font-size: 10px; fill: #9f9f9f; }
    .day { font-size: 9px; fill: #9f9f9f; }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" rx="6" fill="#151515"/>
  <text x="${LEFT_PAD}" y="18" class="title">${total} contributions in the last year</text>
  ${monthLabels}
  ${dayLabels}
  ${cells}
</svg>`;

await writeFile("assets/contribution-graph.svg", svg, "utf8");
console.log(`Wrote assets/contribution-graph.svg (${total} contributions, max/day ${maxCount})`);
