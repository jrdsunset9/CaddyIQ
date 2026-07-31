import { Router, type IRouter } from "express";
import { COURSES } from "../data/courses";
import type { CourseData } from "../data/courses";

const router: IRouter = Router();

// Startup log — confirms the local course dataset was imported successfully
console.log(`[courses] Local course database loaded: ${COURSES.length} courses`);
if (COURSES.length === 0) {
  console.warn("[courses] WARNING: COURSES array is empty — search will return nothing!");
}

const cache = new Map<string, { data: CourseData[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

const GOLFCOURSE_API_KEY = process.env.GOLFCOURSE_API_KEY;

async function searchExternal(q: string): Promise<CourseData[] | null> {
  if (!GOLFCOURSE_API_KEY) {
    console.warn(`[courses] searchExternal("${q}") skipped — GOLFCOURSE_API_KEY not set`);
    return null;
  }
  try {
    const url = `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Key ${GOLFCOURSE_API_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn(`[courses] searchExternal("${q}") failed — ${res.status} ${res.statusText}`);
      return null;
    }
    const json = await res.json() as { courses?: Array<{
      id: number;
      club_name: string;
      course_name: string;
      location?: { city?: string; state?: string };
      holes?: Array<{ hole_number: number; par: number; yardage?: { gold?: number; blue?: number; white?: number; red?: number } }>;
    }> };
    if (!json.courses?.length) {
      console.log(`[courses] searchExternal("${q}") returned 0 courses`);
      return null;
    }
    console.log(`[courses] searchExternal("${q}") returned ${json.courses.length} courses`);
    return json.courses.slice(0, 8).map(c => {
      const name = c.club_name !== c.course_name
        ? `${c.club_name} (${c.course_name})`
        : c.club_name;
      const holes = (c.holes ?? []).map(h => ({
        holeNumber: h.hole_number,
        par: h.par,
        distances: {
          black: h.yardage?.gold ?? 0,
          blue: h.yardage?.blue ?? 0,
          white: h.yardage?.white ?? 0,
          red: h.yardage?.red ?? 0,
        },
      }));
      const par = holes.reduce((s, h) => s + h.par, 0) || 72;
      return {
        id: `ext-${c.id}`,
        name,
        city: c.location?.city ?? "",
        state: c.location?.state ?? "",
        par,
        holes,
      } satisfies CourseData;
    });
  } catch (e) {
    const err = e as Error;
    console.warn(`[courses] searchExternal("${q}") threw: ${err?.name ?? "Error"} — ${err?.message ?? "(no message)"}`);
    return null;
  }
}

router.get("/courses", async (req, res) => {
  const rawQ = (req.query.q as string) || "";
  const q = rawQ.trim().toLowerCase();

  console.log(`[courses] GET /api/courses?q="${rawQ}" → normalized="${q}" dbSize=${COURSES.length}`);

  // Allow 1-char queries through (was previously blocking short queries like "a" or blank).
  // Empty query still returns default list.
  if (q.length === 0) {
    res.json({ courses: COURSES.slice(0, 12) });
    return;
  }

  const cacheKey = q;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    // Slice on cache hit too — previously cached responses could exceed the
    // 12-result cap that fresh responses enforce, leaking >12 to clients.
    res.json({ courses: cached.data.slice(0, 12) });
    return;
  }

  // Tokenized case-insensitive match. Splits the query on whitespace and
  // requires every token to appear somewhere in the joined haystack
  // (name + city + state). Punctuation/diacritics get stripped on both
  // sides so "st andrews" matches "St. Andrew's" and "north plains pumpkin"
  // matches "Pumpkin Ridge … North Plains, OR" regardless of word order.
  const normalize = (s: string): string =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  // Detect 2-letter uppercase tokens BEFORE we normalize to lowercase — these
  // are almost certainly US state codes ("OR", "CA", "TX") and should match
  // the state field exactly rather than fuzzy-substring across name+city.
  // Without this, "OR" matched substrings inside "Portland", "Coronado", etc.
  const STATE_CODE_RE = /^[A-Z]{2}$/;
  const stateCodeTokens = rawQ.split(/\s+/).filter(t => STATE_CODE_RE.test(t));

  // Cap token count so a 1000-word query can't DOS the filter.
  const tokens = normalize(q).split(" ").filter(t => t.length > 0).slice(0, 8);

  const local = COURSES.filter(c => {
    // State code constraint: every uppercase 2-letter token in the original
    // query must equal the course's state code (case-insensitive).
    if (stateCodeTokens.length > 0) {
      const courseState = (c.state || "").toUpperCase();
      if (!stateCodeTokens.every(s => courseState === s.toUpperCase())) return false;
    }
    const haystack = normalize(`${c.name || ""} ${c.city || ""} ${c.state || ""}`);
    if (tokens.length === 0) return haystack.includes(normalize(q));
    return tokens.every(t => haystack.includes(t));
  });

  console.log(`[courses] Local matches for "${q}" (tokens: ${JSON.stringify(tokens)}, stateCodes: ${JSON.stringify(stateCodeTokens)}): ${local.length}`);

  // Fallback threshold raised from <3 to <8 so the external API augments
  // even moderately-populated local results — most "famous course" queries
  // hit only 1–2 thin local matches and need real DB augmentation.
  let external: CourseData[] | null = null;
  if (local.length < 8) {
    external = await searchExternal(q);
  }

  // Dedupe on `${name}|${city}|${state}` rather than name alone — two real
  // courses with the same name in different cities (e.g. "Pine Valley" in
  // NJ and CA) were being silently collapsed into one.
  const dedupeKey = (c: CourseData): string =>
    `${(c.name || "").toLowerCase()}|${(c.city || "").toLowerCase()}|${(c.state || "").toLowerCase()}`;

  const results = external
    ? (() => {
        const localKeys = new Set(local.map(dedupeKey));
        return [
          ...local,
          ...external.filter(e => !localKeys.has(dedupeKey(e))),
        ];
      })()
    : local;

  cache.set(cacheKey, { data: results, ts: Date.now() });
  res.json({ courses: results.slice(0, 12) });
});

export default router;
