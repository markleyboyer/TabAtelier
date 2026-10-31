# Tab Atelier

Tab Atelier is a local browser extension for Chrome and other Chromium-based browsers (Edge, Brave, Vivaldi, Opera) for turning tab overload into a dashboard you can act on.

## What it does

- Shows every open tab across every window.
- Searches by title, URL, domain, and project rule.
- Detects duplicate URLs and stale tabs.
- Creates tab groups from smart stacks.
- Saves selected tabs as restorable sessions inside the extension.
- Exports selected tabs or sessions as bookmark HTML files that Raindrop.io can import.
- Copies selected URLs for quick sharing or manual saving.
- Provides Sweep mode for quickly deciding which tabs to keep, save, or close.

## Install

Requires Chrome 121 or later, or a Chromium-based browser built on it.

1. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository's folder (the one containing `manifest.json`).
5. Pin **Tab Atelier** in the toolbar.
6. Click the extension icon, then **Open dashboard**.

You can also open it with `Alt+Shift+T`. On Mac keyboards, `Alt` is the `Option` key.

## Raindrop.io workflow

Use **Export for Raindrop** on selected tabs, stacks, or saved sessions. The extension creates a standard bookmark HTML file grouped by project. In Raindrop.io, import that bookmark file into the collection you want.

The extension does not need your Raindrop account or API token. That keeps the first version private and low-friction.

## Suggested daily routine

1. Open Tab Atelier.
2. Go to **Smart stacks** and group anything active.
3. Go to **Sweep mode**.
4. Mark useful-but-not-active tabs as **Save**.
5. Mark junk or duplicates as **Close**.
6. Run **Save marked, close marked**.

The rule of thumb: open tabs are for active work; saved sessions and Raindrop are for memory.
