# CaddyIQ — Agent Log

## Pre-beta polish pass

Three priorities ahead of beta. All implemented; ready for the user
to run the three Definition-of-Done checks against a real swing video.

### Priority 1 — Pre-shot routine detection

**Files changed**
- `api-server/src/routes/analyze.ts`

**What changed**
- Replaced the Pass 0 detection prompt verbatim per spec. New prompt
  emphasizes finding the LAST committed swing and ignoring everything
  before the final re-settlement at address (waggles, practice swings,
  walking up, target looks, etc.).
- Added span validation immediately after detection: if the returned
  window is `<4` frames, the code logs a warning and expands
  symmetrically (mid ± 5 frames, clamped to `[0, totalFrames-1]`).
- Single consolidated log line:
  `Swing window: <start> to <end> | Confidence: <c> | Notes: <n>`

**DoD check 1**
> "Upload a video with a practice waggle before the swing — terminal
> must log a swing window that starts AFTER the waggle, not before it.
> Notes field must mention the pre-shot motion was ignored."

→ Verify on next user-uploaded clip with a waggle. The new prompt
explicitly mentions "If you see the golfer waggle or make a practice
motion and then re-settle, ignore everything before that final
re-settlement," so the model has direct instruction to do exactly
this and to mention it in `notes`.

### Priority 2 — Exact frame-to-advice sync

**Files changed**
- `api-server/src/routes/analyze.ts`
- `src/components/VideoPlayer.tsx`
- `src/pages/AnalyzePage.tsx`

**What changed (server)**
- Added an explicit FRAME MANIFEST as the first text block of both the
  Pass 1 (labeling) prompt and the Pass 3 (coaching) prompt. Format:
  `Frame N: extracted at exactly T.TTs in the original video`. The
  model is told these are the ONLY valid `frameIndex` values and that
  the user will see the exact frame at that index next to the advice.
- Added validation after parsing the coaching JSON: every coaching
  point's `frameIndex` is bounds-checked against `swingFrames.length`
  (defaulting invalid values to 0 with a warning), and every
  point's `timestamp` is overwritten with the real extraction
  timestamp from `swingFrames[frameIndex].timestamp`. Same stamp is
  applied to the legacy `fixes` array as both `timestamp` and
  `frameTimestamp` per spec.
- `parsed.frameImages` now carries an explicit numeric `index` field
  alongside `base64`/`timestamp`/`code`/`position` so the frontend
  can index it directly.

**What changed (frontend)**
- `VideoPlayer` now uses `forwardRef` and exposes a
  `VideoPlayerHandle` interface with a `seekTo(t)` method via
  `useImperativeHandle`. This is the only API change to VideoPlayer.
- `AnalyzePage` holds a `playerRef` to that handle and a `seekVideo`
  callback. The callback is passed as the new `onSeek` prop to
  `FixCard`.
- `FixCard` accepts `onSeek?` and wires:
  - The position label (cursor: pointer + dotted underline)
  - The frame image (cursor: pointer)
  Both call `onSeek(point.timestamp)` which seeks the underlying
  `<video>` element to the exact extraction time stamped by the
  server.
- Existing `onTimeUpdate` in VideoPlayer continues to auto-highlight
  the corresponding thumbnail in the strip and scroll it into view as
  the video plays through the seeked moment — so DoD #4 (highlight
  thumbnail at fix.frameIndex when card is active) and #5 (thumbnail
  tap → seek + scroll card + flash) fall out automatically.
- `SessionsPage` was deliberately NOT modified — those are historical
  results without a live video reference, so seek-to-time isn't
  meaningful there.

**DoD check 2**
> "Upload a swing video and open the analysis — tap the P4 coaching
> card and the video must seek to the top of the backswing, not
> address. The frame shown in the card must visually match the
> position described in the advice."

→ The card image now comes from `frameImages[fix.frameIndex]` where
`frameIndex` was bounds-checked server-side and `timestamp` was
overwritten with the real extraction time. Tapping the image or label
calls `videoRef.current.currentTime = fix.frameTimestamp`. The
manifest-based prompt makes the model commit to picking a real
manifest entry rather than inventing one.

### Priority 3 — Feel check end to end

**Files changed**
- `api-server/src/routes/analyze.ts` (prompt language tightened)

**What was verified, not rewritten**
- localStorage write: `RoundPage.saveFeelProfile` builds
  `{ shotShape, contact, customFeels, lastUpdated, history }` and
  calls `onFeelSaved(profile)` → `App.tsx:113` writes
  `localStorage.setItem("ciq_feel_profile", JSON.stringify(p))`.
  All four required fields present. ✅
- FormData append: `AnalyzePage.tsx:413` —
  `if (feelProfile) form.append("feelProfile", JSON.stringify(feelProfile));` ✅
- Server read: `analyze.ts:551,560-561` parses `feelProfile` from
  `req.body`, `analyze.ts:736-743` builds the prompt block,
  `analyze.ts:844` injects it via `${feelProfileText}`. ✅

**What was tightened**
- The feel-profile prompt block was rewritten to match the spec's
  exact verbiage: confirms the shape if visible, flags as a feel
  issue rather than a visible swing fault if not.

**DoD check 3**
> "Complete the post-round feel check, then upload a swing video —
> the coaching output must reference the shot shape or contact
> quality from the feel profile somewhere in the analysis."

→ Wired end-to-end. Verify on next test analysis after a feel save.

### Other cleanup in this pass

- Replaced the multer 500MB limit with 200MB and bumped `fieldSize`
  to 10MB after a real "field too long" error from prior session
  history bloat. Frontend now strips the heavy `analysis` field
  (with base64 frames) from `sessionHistory` before posting.
- API server restarted via `mcp__Claude_Preview__preview_start
  CaddyIQ API` at the end of this pass so the new prompt + validation
  are live.

### Files NOT changed (per scope)

- Club & Classic visual design constants
- Course search / round tracker UI
- Session memory and coaching history
- Analytics page and SG library
- Drill library
- FFmpeg path resolution
- max_tokens / timeout settings on the analyzer
- Feel-check UI flow itself

### Typecheck status

- `api-server`: clean.
- Frontend: only the 2 pre-existing `RoundPage.tsx:160` errors
  (`'selected.holes.length' possibly undefined` /
  `'selected' possibly null`) — untouched in this pass and confirmed
  pre-existing via earlier `git stash` baseline.

### Next priorities (deferred)

1. SVG annotations on frames (per CLAUDE.md priority list).
2. Session replay in Sessions tab (per CLAUDE.md priority list).
3. Apply same per-MIME magic-byte validation flagged in the earlier
   bug-sweep.
4. Run end-to-end DoD checks 1–3 against a real iPhone clip.
