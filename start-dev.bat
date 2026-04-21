@echo off
set PATH=C:\Program Files\nodejs;%PATH%

REM Launch the API server in a new window so /api proxy has an upstream on :3001.
REM Without this, /api/courses and /api/analyze return nothing and the UI shows "no courses".
start "CaddyIQ API" cmd /k "cd /d C:\Users\jrdsu\OneDrive\Documents\CaddyIQ\api-server && C:\Users\jrdsu\OneDrive\Documents\CaddyIQ\api-server\node_modules\.bin\tsx.cmd --env-file=.env src/index.ts"

REM Launch the Vite dev server in this window
"C:\Users\jrdsu\OneDrive\Documents\CaddyIQ\node_modules\.bin\vite.cmd" --port 3000
