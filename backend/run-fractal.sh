#!/bin/bash
# Run TypeScript Fractal backend using tsx
cd /app/backend
exec npx tsx watch src/app.fractal.ts
