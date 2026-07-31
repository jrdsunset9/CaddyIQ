# CaddyIQ — SwiftUI iOS Build Specification

## Read this first, every session
This document is the complete specification for the CaddyIQ iOS app
built in SwiftUI. Read it in full before writing any code. Every design
decision, color value, font choice, and interaction is defined here.
Do not deviate from this spec without asking the user first.

Also read CLAUDE.md and AGENT_LOG.md before starting work.

---

## Project Overview

CaddyIQ is a premium AI-powered golf coaching app. The iOS app is a
native SwiftUI frontend that calls the existing Node.js backend API
for all data — swing analysis, course search, session history, and
analytics. The backend URL will be stored in a Config.swift file.

This is NOT a GPS app. NOT a social network. NOT a swing rating app.
It IS a coaching relationship that gets smarter over time.

---

## Xcode Project Setup

Project name: CaddyIQ
Bundle ID: com.caddyiq.app
Minimum iOS: 16.0
Swift version: 5.9
Architecture: MVVM (Model-View-ViewModel)
Package dependencies: None required initially — use native SwiftUI only

Folder structure:
CaddyIQ/
  App/
    CaddyIQApp.swift
    Config.swift
  Views/
    Round/
    Analyze/
    Sessions/
    Analytics/
    Drills/
    Shared/
  ViewModels/
    RoundViewModel.swift
    AnalyzeViewModel.swift
    SessionViewModel.swift
    AnalyticsViewModel.swift
  Models/
    Course.swift
    Hole.swift
    Session.swift
    FeelProfile.swift
    AnalyticsData.swift
  Services/
    APIService.swift
    StorageService.swift
  Resources/
    Assets.xcassets
    Fonts/

---

## Design System — Full Club & Classic

This is the ONLY design language for this app. Every screen uses
these values. Never use Apple default blue, never use SF Symbols
as primary navigation labels, never use standard iOS List styling.

### Colors

Define all colors in Assets.xcassets as Color Sets:

DeepGreen:    #0F2417  (hero cards, primary buttons, dark backgrounds)
AccentGreen:  #2A6640  (active states, links, confirmation)
LightGreen:   #EDF4EE  (selected states, success backgrounds)
MintGreen:    #7FB890  (text on dark green backgrounds)
WarmWhite:    #FAFAF8  (page background)
CardWhite:    #FFFFFF  (card backgrounds)
BorderColor:  #E8E4DC  (all card borders)
DividerColor: #F0EDE6  (row dividers)
MutedText:    #9A8F7E  (secondary text, labels)
BodyText:     #5C5445  (body copy)
DeepText:     #0F2417  (headings, primary text)
AmberAccent:  #B45309  (warnings, focus areas)
AmberLight:   #FFF8F0  (amber card backgrounds)
ErrorRed:     #8B1C1C  (over par scores)

### Typography

Import Georgia font (serif) — use for all headings, wordmark, scores,
session titles, course names, and hero card content.
System font (-apple-system / SF Pro) — use for all body text, labels,
captions, buttons, and navigation items.

Font scale:
- Wordmark: Georgia 22pt regular, letter-spacing 0.04em
- Page title: Georgia 26pt regular
- Section title: Georgia 20pt regular
- Card title: Georgia 16pt regular
- Card subtitle: Georgia 13pt regular
- Score display: Georgia 28pt regular
- Body text: SF Pro 14pt regular, line-height 1.6
- Label: SF Pro 11pt semibold, uppercase, letter-spacing 0.08em
- Caption: SF Pro 10pt regular
- Button: SF Pro 14pt bold
- Tab label: SF Pro 11pt semibold

### Spacing

Page padding: 16pt horizontal
Section spacing: 24pt between sections
Card padding: 16pt internal
Card corner radius: 12pt
Button corner radius: 8pt
Row height: 52pt minimum (accessibility)
Tab bar height: 56pt + safe area

### Cards

Standard card:
  background: CardWhite
  border: 1pt, BorderColor
  cornerRadius: 12
  padding: 16

Dark hero card:
  background: DeepGreen
  cornerRadius: 12
  padding: 16
  no border

Confirmation card (success):
  background: LightGreen
  border: 1pt, #C5DEC8
  cornerRadius: 12
  padding: 12

Warning card:
  background: AmberLight
  border: 1pt, #E8D5B5
  cornerRadius: 12
  padding: 12

### Buttons

Primary button:
  background: AccentGreen (#2A6640)
  foreground: white
  height: 50pt
  cornerRadius: 8
  font: SF Pro 14pt bold
  full width

Secondary button:
  background: clear
  border: 1pt, BorderColor
  foreground: BodyText
  height: 44pt
  cornerRadius: 8
  font: SF Pro 13pt semibold

Dark primary button:
  background: DeepGreen (#0F2417)
  foreground: white
  height: 50pt
  cornerRadius: 8
  font: SF Pro 14pt bold

### Tab Bar

Custom tab bar — NOT the standard SwiftUI TabView style.
Build as a custom HStack at the bottom of the screen.
Background: WarmWhite (#FAFAF8)
Top border: 1.5pt, BorderColor
5 tabs: Round | Analyze | Sessions | Analytics | Drills
Tab label only — no SF Symbols icons, text labels only
Active tab: DeepText color, 2pt AccentGreen underline
Inactive tab: MutedText color
Font: SF Pro 11pt semibold
Height: 56pt + bottom safe area inset

### Navigation

No standard NavigationBar title style.
Each screen manages its own header.
Header layout: wordmark left, avatar/context right
Wordmark: "Caddy" + italic "IQ" in AccentGreen, Georgia 17pt
Back navigation: custom back button, no default iOS back arrow label

### Section Labels

Uppercase label above sections:
  font: SF Pro 10pt semibold
  color: MintGreen on dark backgrounds, MutedText on light
  letter-spacing: 0.1em
  text-transform: uppercase
  margin-bottom: 8pt

---

## Screen Specifications

---

### 1. Onboarding Screen
Shown once on first launch. Check UserDefaults for "ciq_onboarded" key.

Layout:
- Full screen, DeepGreen background
- CaddyIQ wordmark centered, Georgia 28pt, white + italic IQ in MintGreen
- Tagline: "Your AI golf coach" SF Pro 12pt, rgba(white, 0.5)
- 4 feature rows with bullet dots:
  "Round tracker with real course data and hole-by-hole scoring"
  "AI swing analyzer that remembers every session"
  "Post-round feel check connects rounds to swing analysis"
  "Analytics powered by Mark Broadie's strokes gained methodology"
- Each row: 6pt MintGreen circle dot + SF Pro 13pt rgba(white, 0.75)
- "Get started" primary button (AccentGreen)
- On tap: set UserDefaults "ciq_onboarded" = true, navigate to main app

---

### 2. Round Tab — Course Selector

Shown when no active round exists.

Header: standard CaddyIQ header
Body:
- Section label: "Find your course"
- Search TextField:
    placeholder: "Search by course name or city..."
    background: CardWhite
    border: 1pt BorderColor
    cornerRadius: 8
    font: Georgia 13pt
    padding: 11pt 14pt
- Live search results as user types (debounced 300ms)
- Each result row:
    course name: Georgia 14pt, DeepText
    city/state: SF Pro 11pt, MutedText
    par: SF Pro 11pt bold, AccentGreen, right-aligned
    tap to select
- Selected row: LightGreen background, AccentGreen border, green checkmark
- "Can't find your course? Enter pars manually" — SF Pro 12pt, MutedText, centered below list
- "Start round at [Course Name]" primary button — appears after selection

API call: GET /api/courses?q={searchText}

---

### 3. Round Tab — Active Round

Shown when a round is in progress.

Header: CaddyIQ wordmark + "Active round" label

Dark hero card at top:
  - Course name: Georgia 16pt, white
  - Score to par: Georgia 22pt, MintGreen if negative, AmberAccent if positive, white if even
  - "thru X holes" caption: SF Pro 9pt, rgba(white, 0.45)

Hole progress strip:
  - Scrollable HStack of 18 numbered circles
  - Circle size: 28pt diameter
  - Completed: LightGreen fill, AccentGreen text
  - Active: DeepGreen fill, white text
  - Future: DividerColor fill, MutedText text
  - Tappable — navigates to that hole and restores saved data

Current hole card (CardWhite):
  - "Hole X" Georgia 26pt DeepText + "Par Y" pill (LightGreen bg, AccentGreen text)
  - Strokes stepper: minus button | Georgia 20pt count | plus button
    Default value = hole par
    Minus/plus buttons: 32pt squares, BorderColor border, F8F6F0 background
  - Putts stepper: same style, default = 2
  - Fairway hit toggle (hidden on par 3):
    Label: SF Pro 10pt semibold, MutedText, uppercase
    Two-segment control: "Yes" | "No"
    Active: CardWhite background, AccentGreen text
    Inactive: F0EDE6 background, MutedText text
  - GIR toggle: same style as fairway
  - "Save & next hole" primary button

Recent holes list (last 4 holes):
  - Each row: "Hole X — Par Y" left, score result right
  - Score color: AccentGreen for birdie/eagle, AmberAccent for bogey, ErrorRed for double+, MutedText for par

"Finish round" button: DeepGreen background, white text

---

### 4. Post-Round Feel Check — 3 Step Flow

Triggered by "Finish round" button.

Round summary dark hero card:
  Course name, score, to par, putts, FIR
  "Finish round & log how it felt" primary button
  "Skip feel check" secondary button

Step flow (3 steps with dot progress indicator):
  Active dot: AccentGreen, 18pt wide
  Inactive dot: BorderColor, 6pt wide

Step 1 — Shot shape:
  Label: "Shot shape" uppercase
  Title: "What was your predominant miss today?" Georgia 16pt
  7-option grid (3 columns, last item full width):
    Draw, Hook, Fade, Slice, Pull, Push, Two-way miss
    Each item: name bold + sub description
    Selected: LightGreen bg, AccentGreen border
    Unselected: CardWhite bg, BorderColor border
  "Next" primary button

Step 2 — Ball contact:
  Title: "How did contact feel overall?" Georgia 16pt
  5 radio options with name + description:
    Clean & solid, Heavy / fat, Thin / topped, Off the heel, Off the toe
    Selected: radio filled AccentGreen, row LightGreen bg, AccentGreen border
  Back arrow + "Next" button

Step 3 — Personal feels:
  Title: "Did anything feel off in your swing?" Georgia 16pt
  TextEditor (multiline):
    placeholder: "e.g. felt like I was losing lag early..."
    background: CardWhite, border: BorderColor
    cornerRadius: 8, height: 80pt minimum
  Helper text: SF Pro 11pt MutedText, line-height 1.5
  Back arrow + "Save to profile" dark primary button

Confirmation screen:
  Green checkmark circle (52pt, LightGreen bg)
  "Round logged" Georgia 18pt
  Description text SF Pro 13pt MutedText
  3 profile tag pills (LightGreen bg, AccentGreen text)
  "Upload swing for analysis" primary button
  "Back to home" secondary button

Save to: UserDefaults "ciq_feel_profile" as JSON
  { shotShape, contact, customFeels, lastUpdated }

---

### 5. Analyze Tab — Upload Screen

Header: CaddyIQ wordmark

Feel profile banner (shown if feel profile exists):
  LightGreen background, AccentGreen border, 8pt green dot
  SF Pro 12pt AccentGreen text describing active feel profile

Check-in card (shown if previous sessions exist):
  "Before we start" Georgia 15pt
  Previous focus description SF Pro 12pt MutedText
  "Did you work on this since your last session?"
  3 response buttons stacked vertically

Upload zone:
  Dashed border: 2pt, #C5DEC8
  cornerRadius: 12
  background: F8F6F0
  Center content:
    52pt square icon container (LightGreen bg, cornerRadius 12)
    "Upload your swing" Georgia 16pt
    Description SF Pro 12pt MutedText:
      "Upload a swing video from your camera roll.
       Face-on or down-the-line both work.
       MOV, MP4, and HEVC all supported."
    "Choose file" button (AccentGreen bg, white text)
  On tap: PhotosPicker (video only) or UIImagePickerController

Notes field:
  Label: SF Pro 10pt semibold uppercase MutedText
  TextEditor: Georgia 13pt, CardWhite bg, BorderColor border
  Placeholder: "e.g. 7-iron, been working on the shallowing move..."
  Height: 70pt

"Analyze my swing" primary button
  Disabled state: AccentGreen 35% opacity
  Enabled: full AccentGreen after file selected

---

### 6. Analyze Tab — Loading State

Shown while API call is in progress.

Center content:
  48pt circular progress indicator, AccentGreen
  "Analyzing your swing" Georgia 18pt DeepText
  "Reviewing all positions across your full swing..." SF Pro 13pt MutedText

Progress steps (4 rows, CardWhite cards):
  Each: 7pt colored dot + SF Pro 11pt text
  Completed steps: AccentGreen dot + AccentGreen text
  Current step: AmberAccent pulsing dot + DeepText
  Pending steps: BorderColor dot + MutedText text

Steps:
  "Extracting swing frames..."
  "Identifying swing positions..."
  "Analyzing your technique..."
  "Writing your coaching session..."

Step timing: advance every 15 seconds

---

### 7. Analyze Tab — Coaching Result

Scrollable view with all coaching output.

Session header card (DeepGreen):
  "Session X" pill badge (rgba green, MintGreen text)
  "X frames analyzed" secondary badge (rgba white)
  Headline: Georgia 18pt white, line-height 1.3
  Opening message: SF Pro 13pt rgba(white, 0.75), line-height 1.65

Frame strip:
  Horizontal ScrollView
  Each thumbnail: 56pt wide, 40pt tall
  Border: 1.5pt AccentGreen for strength, AmberAccent for focus area
  Position label below: SF Pro 8pt MutedText
  Tapping thumbnail: seeks video to that timestamp

Video player:
  Native AVPlayer
  DeepGreen background
  Timeline below with colored dot markers
  Green dots for strengths, amber for focus areas
  Dot tap: seeks video to that position timestamp

Strengths section:
  Label: "What is working" uppercase
  Each item: 18pt AccentGreen circle checkmark + SF Pro 13pt text
  Background: LightGreen, border: #C5DEC8, cornerRadius: 8

Position breakdown (collapsible):
  Label: "Position by position" uppercase
  Each position card:
    Left border: 3pt AccentGreen (strength), AmberAccent (focus), #93c5fd (improving)
    Position name: SF Pro 12pt bold white
    Status pill: colored per status
    Observation: SF Pro 13pt rgba(white, 0.7)
    Coach note: SF Pro 12pt MintGreen italic

Fix cards (CardWhite):
  Priority badge:
    Priority fix: #fef2f2 bg, #dc2626 text, #fca5a5 border
    Secondary fix: #fff7ed bg, #d97706 text, #fcd34d border
  Position label: SF Pro 9pt MutedText
  Frame image: actual extracted frame at full card width
    cornerRadius: 8, DeepGreen background
    Position label overlay: top-left, SF Pro 8pt white on dark pill
    Status badge: top-right, colored per status
  Fix title: Georgia 15pt DeepText
  Description: SF Pro 12pt BodyText, line-height 1.6
  Pro reference block:
    LightGreen background, AccentGreen left border 3pt
    Player avatar: 28pt circle, DeepGreen bg, MintGreen initials
    Player name bold + comparison text: SF Pro 11pt AccentGreen
  Coach insight block:
    F8F6F0 background, BorderColor left border 3pt
    "Coach insight:" bold + text: SF Pro 12pt BodyText
  Feeling cue box (DeepGreen):
    "Feeling cue" label: MintGreen uppercase SF Pro 9pt
    Cue text: Georgia 13pt italic rgba(white, 0.88)
    Credit line: SF Pro 10pt rgba(white, 0.4)
    Drill section below divider:
      Drill name: SF Pro 11pt bold MintGreen
      Reps: SF Pro 10pt rgba(white, 0.45)
      Description: SF Pro 12pt rgba(white, 0.65)
  YouTube drill card:
    F8F6F0 background, BorderColor border
    Play button: 32pt DeepGreen square, cornerRadius 6
    "Recommended drill" label: AccentGreen SF Pro 10pt bold
    Drill title: SF Pro 12pt bold DeepText
    Channel: SF Pro 10pt MutedText
    Tap: open YouTube search URL in Safari

Week focus card (CardWhite):
  "This week's focus" label: AccentGreen uppercase SF Pro 9pt
  Focus text: Georgia 15pt DeepText, line-height 1.4

Closing message:
  DeepGreen background, cornerRadius 12
  Georgia 13pt italic rgba(white, 0.8), line-height 1.65

Bottom buttons:
  "New session" secondary button
  "View history" AccentGreen primary button

Save complete session to UserDefaults "ciq_history" as JSON array.

---

### 8. Sessions Tab

Header: CaddyIQ wordmark + session count

"Your journey" Georgia 20pt DeepText
"Every session remembered — tap to replay" SF Pro 12pt MutedText

Session list (each row):
  Date block: 36pt square, F0EDE6 bg, cornerRadius 8
    Month: SF Pro 8pt uppercase MutedText
    Day: Georgia 16pt DeepText
  Content:
    Latest badge (first item only): LightGreen bg, AccentGreen text pill
    Session title: Georgia 13pt DeepText
    Sub: SF Pro 10pt MutedText (swing type + frames)
    Focus tag: F0EDE6 bg rounded pill, AccentGreen text SF Pro 10pt bold
  Arrow: SF Pro 14pt MutedText

Archived section:
  LightGreen background, #C5DEC8 border, cornerRadius 10
  "Archived — progress made" uppercase AmberAccent label
  Archived fix title: Georgia 13pt DeepText
  Resolution date: SF Pro 11pt MutedText

Session detail view (on row tap):
  Full coaching result view (same as Analyze result)
  Video player with frame strip if video available
  If no video: frame thumbnail strip only
  "Analyze new swing" primary button at bottom

---

### 9. Analytics Tab

Header: CaddyIQ wordmark + "Career · X rounds"

Dark hero section (DeepGreen, full width, no corner radius at top):
  Left: "Scoring average" caption + Georgia 32pt white score
  Right: "Handicap index" caption + Georgia 24pt MintGreen value
  SG section label: "Strokes gained vs PGA Tour" uppercase MintGreen
  4 SG bar rows:
    Label: SF Pro 11pt rgba(white, 0.6), 70pt wide
    Track: flex width, 6pt height, rgba(white, 0.1) background
    Fill: MintGreen for better values, #E07B5A for worse values
    Value: SF Pro 11pt, colored to match fill

Body section (WarmWhite):
  Scoring trend chart:
    Label: "Scoring trend — last 8 rounds" uppercase MutedText
    CardWhite card with 48pt tall bar chart
    Green bars for rounds at/below scoring avg
    AmberAccent bars for rounds above avg
    Round scores as x-axis labels SF Pro 9pt MutedText

  AI coaching priority card:
    AmberLight background, #E8D5B5 border
    "AI coaching priority" label AmberAccent uppercase
    Priority insight: Georgia 14pt DeepText
    Sub detail: SF Pro 11pt MutedText

  Stat grid (2 columns):
    Each stat card (CardWhite, BorderColor border):
      Label: SF Pro 10pt MutedText
      Value: Georgia 20pt DeepText
      Comparison: SF Pro 10pt — AccentGreen if beating Tour avg, AmberAccent if below

  Stats displayed:
    Fairways hit %, GIR %, Putts per round, Sand save %, 3-putt rate, Best round score

Calculate all stats from stored round data in UserDefaults "ciq_rounds"
Calculate strokes gained using Mark Broadie benchmark tables (built into AnalyticsViewModel)

---

### 10. Drills Tab

Header: CaddyIQ wordmark

"Drill library" Georgia 20pt DeepText
"Categorized drills from leading coaches" SF Pro 12pt MutedText

Category selector (3 pills):
  Active: AccentGreen bg, white text, cornerRadius 100
  Inactive: transparent, BorderColor border, MutedText text
  "Full swing" | "Pitch & chip" | "Putting"

Drill cards (CardWhite, BorderColor border, cornerRadius 12):
  Top row: drill name (Georgia 14pt DeepText) + difficulty badge
    Beginner: LightGreen bg, AccentGreen text
    Intermediate: LightGreen bg, AccentGreen text
    Advanced: F8F6F0 bg, MutedText text
  Description: SF Pro 12pt BodyText, line-height 1.6
  YouTube card: F8F6F0 bg, play button + "Watch on YouTube" SF Pro 12pt bold

---

## API Integration

All API calls go through APIService.swift.
Backend URL stored in Config.swift:

struct Config {
  static let backendURL = "https://your-railway-url.up.railway.app"
}

Key endpoints:
  GET  /api/courses?q={query}           → course search
  POST /api/analyze (multipart)         → swing analysis
    Fields: swing (video file), swingType, feels, notes, history, feelProfile
  GET  /api/health                      → health check

All responses decode to Swift Codable structs.
Handle errors gracefully — show specific error messages not generic failures.
Timeout: 180 seconds for analyze endpoint (video processing is slow)
Show loading states for all network calls.

---

## Data Persistence

Use UserDefaults for all local storage.
Keys match the web app exactly for potential future migration:
  ciq_onboarded          Bool
  ciq_feel_profile       JSON string
  ciq_history            JSON string (array of sessions)
  ciq_rounds             JSON string (array of rounds)
  ciq_checkin_responses  JSON string (array of check-in responses)

Create a StorageService.swift that handles all encode/decode.
Never access UserDefaults directly from Views or ViewModels —
always go through StorageService.

---

## Video Handling

Use PhotosPicker to let user select video from camera roll.
Accept: .movie, .video
After selection: copy to app's temp directory for upload
Upload as multipart/form-data to /api/analyze
Delete temp file after upload completes (success or failure)
Show file size and duration after selection

Video playback in result view:
  Use AVPlayer wrapped in UIViewControllerRepresentable
  Custom controls: play/pause, scrub bar, timestamp display
  Programmatic seeking when user taps frame thumbnails or timeline markers

---

## Session Memory & Feel Profile

On every analyze request pass:
  history: last 10 sessions from ciq_history as JSON
  feelProfile: current ciq_feel_profile as JSON

In AnalyzeViewModel:
  Load both from StorageService before making API call
  After successful analysis: append new session summary to ciq_history
  Session summary format:
    { date, sessionNumber, swingType, headline, faults, improvements, nextFocus }

---

## CLAUDE.md Agent Rules (apply in Xcode sessions)

- Read this file + CLAUDE.md + AGENT_LOG.md before every session
- Build one screen at a time — complete it before moving to next
- Test on iPhone 15 simulator minimum before marking screen done
- Commit to GitHub after each screen is complete
- Never use standard iOS blue color anywhere
- Never use SF Symbols as primary navigation labels
- Never use standard SwiftUI List or Form styling
- Always use Georgia serif for headings, scores, and titles
- Always use the exact color hex values from the Design System above
- Ask before adding any Swift Package dependencies
- Update AGENT_LOG.md before ending each session

---

## Build Order (recommended sequence)

Session 1: Project setup + design system + onboarding screen
Session 2: Tab bar + Round tab (course selector + active round)
Session 3: Post-round feel check 3-step flow
Session 4: Analyze tab (upload + loading + basic result display)
Session 5: Analyze tab (full coaching result with frames + video player)
Session 6: Sessions tab (list + detail view)
Session 7: Analytics tab (SG calculations + charts)
Session 8: Drills tab
Session 9: API integration testing end-to-end
Session 10: Polish, accessibility, TestFlight submission

---

## Before First Mac Session Checklist

- [ ] Apple Developer account approved (developer.apple.com, $99/year)
- [ ] Xcode installed from Mac App Store (free, ~15GB)
- [ ] Backend deployed and live (Railway or Render)
- [ ] Backend URL ready to paste into Config.swift
- [ ] GitHub repo connected
- [ ] This file (SWIFTUI.md) in project root
- [ ] CLAUDE.md updated with SwiftUI build rules
- [ ] AGENT_LOG.md updated with current status

---

*CaddyIQ SwiftUI Spec — created May 2026*
*Full Club & Classic design — Georgia serif, custom everything*
*Do not deviate from this spec without user approval*