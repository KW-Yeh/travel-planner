// Try NAVITIME Route (totalnavi) on RapidAPI: transit routes in Japan.
//
// Usage:
//   1. Put RAPIDAPI_KEY=<your key> in .dev.vars (git-ignored)
//   2. node scripts/navitime-try.ts [start lat,lng] [goal lat,lng] [YYYY-MM-DDThh:mm:ss]
//
// Defaults: Tokyo Station -> Shinjuku Station, tomorrow 09:00 (JST).

try {
  process.loadEnvFile('.dev.vars');
} catch {
  // fall back to the shell environment
}

const key = process.env.RAPIDAPI_KEY;
if (!key) {
  console.error('RAPIDAPI_KEY is missing: add it to .dev.vars or set it in the environment.');
  process.exit(1);
}

const HOST = 'navitime-route-totalnavi.p.rapidapi.com';

function tomorrowNineJst(): string {
  const jstNow = new Date(Date.now() + 9 * 3600_000);
  jstNow.setUTCDate(jstNow.getUTCDate() + 1);
  return `${jstNow.toISOString().slice(0, 10)}T09:00:00`;
}

const [start = '35.681236,139.767125', goal = '35.689592,139.700413', startTime = tomorrowNineJst()] =
  process.argv.slice(2);

const params = new URLSearchParams({
  start,
  goal,
  start_time: startTime,
  datum: 'wgs84',
  coord_unit: 'degree',
  term: '1440',
  limit: '3',
});

const url = `https://${HOST}/route_transit?${params}`;
console.log(`GET ${url}\n`);

const res = await fetch(url, {
  headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST },
});
const text = await res.text();

console.log(`HTTP ${res.status}`);
for (const h of ['x-ratelimit-requests-limit', 'x-ratelimit-requests-remaining']) {
  const v = res.headers.get(h);
  if (v) console.log(`${h}: ${v}`);
}
console.log();

if (!res.ok) {
  console.log(text);
  process.exit(1);
}

type Section = {
  type: 'point' | 'move';
  name?: string;
  move?: string;
  line_name?: string;
  time?: number;
  from_time?: string;
  to_time?: string;
  transport?: { name?: string };
};
type Item = {
  summary?: {
    move?: {
      time?: number;
      transit_count?: number;
      from_time?: string;
      to_time?: string;
      fare?: Record<string, number>;
    };
  };
  sections?: Section[];
};

const data = JSON.parse(text) as { items?: Item[] };
const hhmm = (iso?: string) => iso?.slice(11, 16) ?? '?';

if (!data.items?.length) {
  console.log('No items in response. Raw body:');
  console.log(JSON.stringify(data, null, 2));
  process.exit(0);
}

data.items.forEach((item, i) => {
  const m = item.summary?.move;
  const fare = m?.fare?.unit_0 ?? m?.fare?.unit_48;
  console.log(
    `#${i + 1}  ${hhmm(m?.from_time)} -> ${hhmm(m?.to_time)}  ${m?.time ?? '?'} min, ` +
      `${m?.transit_count ?? '?'} transfers${fare != null ? `, ¥${fare}` : ''}`,
  );
  for (const s of item.sections ?? []) {
    if (s.type === 'point') {
      console.log(`     ● ${s.name ?? ''}`);
    } else {
      const what = s.transport?.name ?? s.line_name ?? s.move ?? '';
      console.log(`     │ ${what} (${s.time ?? '?'} min, ${hhmm(s.from_time)}-${hhmm(s.to_time)})`);
    }
  }
  console.log();
});

await import('node:fs').then((fs) => {
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/navitime-last.json', JSON.stringify(data, null, 2));
  console.log('Full response saved to test-results/navitime-last.json');
});
