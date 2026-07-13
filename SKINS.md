# THE CACHE — skins (art & sound) SOP

THE CACHE is a base-builder game of your real life. Every building, UI piece, and sound is a **swappable skin**, so anyone can restyle the whole game — and creators can make and share their own. This is the convention. It's intentionally simple.

## Folder structure

```
skins/
  default/               ← the built-in skin (ships with the app; your inspiration)
    skin.json            ← the manifest: maps every logical id → the file that provides it
    buildings/           ← one art file per building id
      home-base.svg
    ui/                  ← shared UI art (frames, cursors, badges, panels)
    sounds/              ← one sound file per sound id
      place.wav
  <your-skin>/           ← a new skin = a copy of default/ with the assets swapped
    skin.json
    buildings/ ...
```

Make a skin by **copying `skins/default/` to `skins/<your-skin>/`** and replacing the assets. Keep the *ids* the same; change the *files*. Every piece in `default/` is left visible on purpose — open the folders and use them as a starting point.

## The manifest (`skin.json`)

```json
{
  "id": "your-skin",
  "name": "Human-readable name",
  "author": "you",
  "version": "0.1.0",
  "buildings": { "home-base": { "label": "Home Base", "art": "buildings/home-base.svg" } },
  "sounds":    { "place": "sounds/place.wav" }
}
```

- The **id** on the left (`home-base`, `place`) is what the app asks for — never rename it.
- The **path** on the right is what your skin provides — point it wherever you like inside your skin folder.
- If your skin is missing an id, the app falls back to `default/` for that one piece. So a skin can restyle just one building and inherit the rest.

## Naming convention

- **Building ids are kebab-case and stable:** `home-base`, `pantry`, `supply-line`. The current list lives in `skins/default/skin.json` — the app only ever loads ids listed there.
- **File names match their id** where possible (`home-base.svg`), lower-case, no spaces.
- **Sound ids** name the event, not the sound: `place`, `build`, `coin`, `warn`.

## File types

| Kind | Preferred | Also OK | Notes |
|---|---|---|---|
| Buildings / UI art | **SVG** | PNG (2×, transparent) | SVG scales cleanly and can theme (see below). Keep it flat. |
| Sounds | **WAV** | MP3 | Short, < 1s for UI blips. |

### Art specs (buildings)
- **Canvas:** `240 × 200` viewBox, art seated on the isometric base pad (see the placeholder for the pad geometry).
- **Flat fills** — no heavy gradients/blur (keeps it lightweight and readable at any size).
- **One accent element** (roof/flag/glow) should use `fill="currentColor"` so it tints to the player's chosen app accent. Everything else is your own palette.
- Keep each building **self-contained** (one file, no external refs) so it's portable and inspectable.

## How the app resolves an asset (mental model)

`skin(active).buildings["home-base"].art` → load that file → if missing, use `default`'s. That's the whole rule. Deterministic, no magic.

## Sharing a skin

A skin is just its folder. Zip `skins/<your-skin>/` and share it; a user drops it into their `skins/` and selects it. (Skin-picker UI is on the roadmap; today it's default-only.)
