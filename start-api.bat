@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d "C:\Users\jrdsu\OneDrive\Documents\CaddyIQ\api-server"
"C:\Users\jrdsu\OneDrive\Documents\CaddyIQ\api-server\node_modules\.bin\tsx.cmd" --env-file=.env src/index.ts
