# Tab Atelier

Tab Atelier is a local browser extension for Chrome and other Chromium-based browsers (Edge, Brave, Vivaldi, Opera) for turning tab overload into a dashboard you can act on.

## What it does

- Shows every open tab across every window.
- Searches by title, URL, domain, and project rule.
- Detects duplicate URLs and stale tabs.
- Creates tab groups from smart stacks.
- Saves selected tabs as restorable sessions inside the extension.
- Optionally exports selected tabs or sessions as bookmark HTML files that Raindrop.io can import.
- Copies selected URLs for quick sharing or manual saving.
- Provides Sweep mode for quickly deciding which tabs to keep, save, or close.

## Install

Requires Chrome 121 or later, or a Chromium-based browser built on it.

1. Download `tab-atelier-<version>.zip` from the [latest release](https://github.com/markleyboyer/TabAtelier/releases/latest) and unzip it.
2. Open the extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped folder (the one containing `manifest.json`).
6. Pin **Tab Atelier** in the toolbar.
7. Click the extension icon, then **Open dashboard**.

You can also open it with `Alt+Shift+T`. On Mac keyboards, `Alt` is the `Option` key.

To update, download the new release, replace the folder, and click the reload icon on the extension's card.

## Raindrop.io export (optional)

Raindrop.io export is entirely optional. You don't need a Raindrop account to use Tab Atelier, and everything else works the same whether or not you ever use it.

Use **Export for Raindrop** on selected tabs, stacks, or saved sessions. The extension creates a standard bookmark HTML file grouped by project. In Raindrop.io, import that bookmark file into the collection you want.

The extension never connects to Raindrop and doesn't need your account or API token. The export is a standard bookmark file, so you can also import it into Chrome, Edge, or most other bookmark managers.

## Suggested daily routine

1. Open Tab Atelier.
2. Go to **Smart stacks** and group anything active.
3. Go to **Sweep mode**.
4. Mark useful-but-not-active tabs as **Save**.
5. Mark junk or duplicates as **Close**.
6. Run **Save marked, close marked**.

The rule of thumb: open tabs are for active work; saved sessions and Raindrop are for memory.

## License

[MIT](LICENSE)
