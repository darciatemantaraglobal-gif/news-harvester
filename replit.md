# Project

A React + Vite frontend application migrated from Lovable to Replit.

## Stack

- **Frontend**: React 18, TypeScript, Vite
- **UI**: shadcn/ui, Tailwind CSS, Radix UI primitives
- **Routing**: React Router DOM v6
- **State/Data**: TanStack React Query
- **Forms**: React Hook Form + Zod

## Development

Run the app with `npm run dev` — served on port 5000 via the "Start application" workflow.

## Structure

```
src/
  App.tsx         # Root component with routing
  main.tsx        # Entry point
  pages/          # Route-level page components
  components/     # Reusable UI components
    ui/           # shadcn/ui base components
  hooks/          # Custom React hooks
  lib/            # Utility functions
```

## Notes

- Migrated from Lovable: removed `lovable-tagger` dev plugin, updated Vite server config for Replit compatibility (host `0.0.0.0`, port `5000`, `allowedHosts: true`).
