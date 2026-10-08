Feature stylesheets. Every `*.css` file in this folder is loaded automatically by `src/main.tsx`
after the shared component styles, so a feature can ship its own styles without touching other files.
Use design tokens (`var(--mochi-*)`) instead of literal colours so every theme can restyle the feature.
