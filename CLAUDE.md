# CaddyIQ — Claude Code Agent Instructions

## What This Project Is
CaddyIQ is an AI-powered golf coaching app. It is NOT a GPS 
rangefinder, NOT a social network, NOT a swing rating app.
It IS a coaching relationship that gets smarter over time.

Core features:
- Round tracker with course search and hole-by-hole scoring
- AI swing analyzer using FFmpeg + Claude Vision
- Session memory and adaptive feel profile
- Club & Classic visual design (Georgia serif, #FAFAF8, #2A6640)
- Drill library

## Project Structure
- api-server/ — Node/Express/TypeScript backend
- mockup-sandbox/ — React/Vite/TypeScript frontend
- AGENT_LOG.md — session history and current status
- api-server/.env — API keys (never commit this)

## How To Start Every Session
1. Read AGENT_LOG.md for current status and priorities
2. Read the structure of api-server/src/ and mockup-sandbox/src/
3. Tell the user what you found and what you plan to work on
4. Wait for confirmation before making changes
5. Update AGENT_LOG.md before ending the session

## Decision Rules

### Always ask user before:
- Changing database or localStorage structure
- Changing the visual design system or colors
- Adding a new npm dependency
- Changing how the Claude AI prompt is structured
- Making changes across more than 3 files at once
- Any architectural change

### Never ask, just fix:
- Clear single-solution bugs
- TypeScript errors
- Missing imports
- FFmpeg command parameters
- CSS layout issues
- Hardcoded localhost URLs

### When ambiguous:
Present 2-3 options with tradeoffs and ask user to choose

## Safety Rules
- Read a file before editing it
- Never delete files — comment out or archive instead
- Never modify .env files or API keys
- Never auto-commit to Git — stage only
- If same error persists after 2 fix attempts stop and report
- Never break working functionality while fixing something else
- Run tsc --noEmit after every TypeScript edit

## Never Change These (already working)
- Club & Classic visual design system
- Post-round feel check 3-step flow
- Session memory localStorage structure
- Adaptive feel profile system
- Drill library content
- Course database and search endpoint
- FFmpeg path resolution via findFfmpeg()
- .env manual loader at top of index.ts
- Hole-by-hole scoring and navigation

## Never Build These
- GPS or rangefinder features
- Social features or leaderboards
- Swing comparison with Tour player video
- Historical stats charts or graphs
- Tee time booking
- Numerical swing scores of any kind

## Definition of Done
A fix is complete when:
- Works with a real iPhone MOV video
- Works in regular terminal outside Claude Code
- No errors in terminal during operation
- UI reflects result correctly in browser
- Session saves to localStorage and persists on refresh
- Works on second use not just first

## Token Efficiency Rules
- Read only files relevant to current task
- Make targeted edits — minimum code needed
- Batch related small fixes into one edit
- Keep Claude API system prompts concise
- Prioritize highest impact work as limits approach

## Progress Logging
After every work session update AGENT_LOG.md with:
- What was completed with file names
- Any errors and how they were resolved
- What is blocked and needs user input
- Exact next priority for next session
- Any architectural observations or security flags

## Current Issue Priority
1. JSON parsing — Claude response truncating mid-JSON
2. Session timeout — analysis over 2 minutes
3. Frame-to-advice sync — frames not matching positions
4. SVG annotations on frames
5. Feel check verification
6. Session replay in Sessions tab

## Product Vision
- Target user: amateur golfer who wants to improve
- Monetization: freemium — limited free analyses, paid unlimited
- End goal: native iOS app built in SwiftUI
- Backend stays as Node/Express — becomes the API server iOS calls
- Competitive advantage: connected coaching memory, feel profile,
  no scores, Club & Classic design
- Main competitor: 18 Birdies (GPS-first, swing analysis is add-on)
- CaddyIQ wins on: coaching depth, session memory, feel layer

## What CaddyIQ Is NOT — Do Not Build These
- Not a GPS rangefinder
- Not a social network
- Not a swing rating app with numerical scores
- Not a stats dashboard with charts
- Not a tee time booking app
- Not a Tour player comparison tool

## Monetization Awareness
- Free tier: limited swing analyses per month, basic round tracking
- Paid tier: unlimited analyses, full session memory, feel profile
- API cost per analysis: approximately $0.03-0.08
- Flag any feature that significantly increases API calls per session
- Do not implement payment gating yet — just flag in AGENT_LOG.md

## Security Checklist
On every change verify:
- API key never appears in frontend code or logs
- Uploaded videos deleted from temp after processing
- No user data logged in plain text
- File upload size limits enforced server-side
- .env is in .gitignore and never committed
- FFmpeg temp files cleaned up in finally block

## iOS Transition Notes
- Backend API stays permanent — make it robust and documented
- Avoid browser-specific APIs
- Keep localStorage structures simple and flat
- Flag complex UI patterns that would be hard in SwiftUI
- Every API endpoint should be RESTful and clean

## Competitive Context
18 Birdies is the main competitor. They are GPS-first with
swing analysis as an add-on. CaddyIQ wins on coaching depth,
session memory, and the feel profile layer they do not have.
Never build GPS features to compete with them directly. 
