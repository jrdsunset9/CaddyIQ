import { Router, type IRouter } from "express";
import { COURSES } from "../data/courses";
import type { CourseData } from "../data/courses";

const router: IRouter = Router();

const cache = new Map<string, { data: CourseData[]; ts: number }>();
const CACHE_TTL = 60 * 60 * 1000;

const GOLFCOURSE_API_KEY = process.env.GOLFCOURSE_API_KEY;

async function searchExternal(q: string): Promise<CourseData[] | null> {
  if (!GOLFCOURSE_API_KEY) return null;
  try {
    const url = `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Key ${GOLFCOURSE_API_KEY}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const json = await res.json() as { courses?: Array<{
      id: number;
      club_name: string;
      course_name: string;
      location?: { city?: string; state?: string };
      holes?: Array<{ hole_number: number; par: number; yardage?: { gold?: number; blue?: number; white?: number; red?: number } }>;
    }> };
    if (!json.courses?.length) return null;
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
  } catch {
    return null;
  }
}

router.get("/courses", async (req, res) => {
  const q = ((req.query.q as string) || "").trim().toLowerCase();

  if (q.length < 2) {
    res.json({ courses: COURSES.slice(0, 12) });
    return;
  }

  const cacheKey = q;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    res.json({ courses: cached.data });
    return;
  }

  const local = COURSES.filter(c =>
    c.name.toLowerCase().includes(q) ||
    c.city.toLowerCase().includes(q) ||
    c.state.toLowerCase() === q
  );

  let external: CourseData[] | null = null;
  if (local.length < 3) {
    external = await searchExternal(q);
  }

  const results = external
    ? [...local, ...external.filter(e => !local.some(l => l.name === e.name))]
    : local;

  cache.set(cacheKey, { data: results, ts: Date.now() });
  res.json({ courses: results.slice(0, 12) });
});

export default router;
