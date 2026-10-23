# Avatar: The Four Nations

An open-world 3D action RPG for the browser, inspired by *Avatar: The Last Airbender*.
You play the Avatar. Start in one of the Four Nations, learn all four elements from masters
across the world, enter the Avatar State at will, and eventually awaken the **Elements Sphere**.

Built with TypeScript, Vite and three.js. All models, textures, music and sound are generated
procedurally at runtime, so there are no asset downloads and no external services.

## Run

```bash
npm install
npm run dev        # open the printed URL
npm run build      # production build in dist/
```

## Controls (default, remappable in Settings → Controls)

| Action | Key |
|---|---|
| Move / Camera | WASD / Mouse |
| Primary attack / Aim–charge heavy | LMB / hold RMB |
| Techniques | 1–4 (5: combined technique in the Elements Sphere) |
| Switch element | Tab / mouse wheel |
| Jump (hold while falling to glide as an Airbender) | Space |
| Sprint / Dodge | Shift / Q |
| Interact / Companion | E / F |
| Draw water from a nearby source | R |
| Avatar State | T |
| Lock-on | Middle mouse / Z |
| Map / Journal / Techniques / Inventory / Companions / Character | M / J / K / I / P / C |
| Pause | Esc |

Gamepads (standard mapping) and touch controls are supported.

## Tests

```bash
npm run typecheck
npm test                              # unit tests
node tests/e2e/smoke.e2e.mjs          # headless browser smoke test
```

See `CLAUDE.md` for architecture and contributor conventions.

*A non-commercial fan project. Avatar: The Last Airbender belongs to its respective owners.*
