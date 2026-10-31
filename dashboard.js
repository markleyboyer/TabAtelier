const state = {
  tabs: [],
  windows: [],
  sessions: [],
  projectRules: [],
  selected: new Set(),
  sweep: new Map(),
  draggingTabId: null,
  activeView: "all",
  activeWindowId: "all",
  query: ""
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  tabCount: $("#tabCount"),
  windowCount: $("#windowCount"),
  duplicateCount: $("#duplicateCount"),
  staleCount: $("#staleCount"),
  windowList: $("#windowList"),
  tabList: $("#tabList"),
  clusterList: $("#clusterList"),
  duplicateList: $("#duplicateList"),
  sweepList: $("#sweepList"),
  sessionList: $("#sessionList"),
  ruleList: $("#ruleList"),
  message: $("#message"),
  searchInput: $("#searchInput")
};

const storageGet = (defaults) =>
  new Promise((resolve) => chrome.storage.local.get(defaults, resolve));

const storageSet = (value) =>
  new Promise((resolve) => chrome.storage.local.set(value, resolve));

const tabsQuery = (query) =>
  new Promise((resolve) => chrome.tabs.query(query, resolve));

const windowsGetAll = () =>
  new Promise((resolve) => chrome.windows.getAll({ populate: false }, resolve));

const tabGroupsQuery = () =>
  new Promise((resolve) => chrome.tabGroups.query({}, resolve));

const groupTabs = (tabIds, title, color) =>
  new Promise((resolve) => {
    chrome.tabs.group({ tabIds }, (groupId) => {
      if (chrome.runtime.lastError) {
        toast(chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      chrome.tabGroups.update(groupId, { title, color }, () => {
        if (chrome.runtime.lastError) toast(chrome.runtime.lastError.message);
        resolve(groupId);
      });
    });
  });

// Pinned tabs can't join tab groups, so they are left out. Returns how many tabs were grouped.
const groupTabSet = async (tabs, title, color) => {
  const byWindow = new Map();
  tabs.filter((tab) => !tab.pinned).forEach((tab) => {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  });

  let grouped = 0;
  for (const windowTabs of byWindow.values()) {
    if (await groupTabs(windowTabs.map((tab) => tab.id), title, color) !== null) grouped += windowTabs.length;
  }
  return grouped;
};

const groupedMessage = (grouped, total, label = "") => {
  const skipped = total - grouped;
  return `Grouped ${grouped} tabs${label}.${skipped ? ` Skipped ${skipped} pinned or unavailable.` : ""}`;
};

const removeTabs = (tabIds) =>
  new Promise((resolve, reject) =>
    chrome.tabs.remove(tabIds, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    })
  );

const updateTab = (tabId, change) =>
  new Promise((resolve) => chrome.tabs.update(tabId, change, resolve));

const updateWindow = (windowId, change) =>
  new Promise((resolve) => chrome.windows.update(windowId, change, resolve));

const moveTabToWindow = (tabId, windowId) =>
  new Promise((resolve, reject) => {
    chrome.tabs.move(tabId, { windowId, index: -1 }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });

const createTab = (url, active = false) =>
  new Promise((resolve) =>
    chrome.tabs.create({ url, active }, (tab) => resolve(chrome.runtime.lastError ? null : tab))
  );

const createWindow = (urls) =>
  new Promise((resolve) =>
    chrome.windows.create({ url: urls, focused: false }, (window) => resolve(chrome.runtime.lastError ? null : window))
  );

// Browser-internal pages (chrome://, edge://, about:, other extensions) can't be opened by an extension.
const isRestorableUrl = (url) => /^(https?|ftp|file):/i.test(url || "");

// A Blob URL avoids the ~2 MB cap on data: URLs, so large exports still download.
const downloadFile = (filename, content, mime = "text/html") => {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  chrome.downloads.download({ url, filename, saveAs: true }, () => {
    if (chrome.runtime.lastError) toast(`Export failed: ${chrome.runtime.lastError.message}`);
  });
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
};

const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"].forEach((key) =>
      parsed.searchParams.delete(key)
    );
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url || "";
  }
};

const escapeHtml = (value = "") =>
  value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);

const colorForDomain = (domain) => {
  const colors = ["blue", "green", "yellow", "red", "purple", "cyan", "pink", "grey"];
  let score = 0;
  for (const char of domain) score += char.charCodeAt(0);
  return colors[score % colors.length];
};

const getProject = (tab) => {
  const haystack = `${tab.title || ""} ${tab.url || ""} ${domainOf(tab.url || "")}`.toLowerCase();
  const rule = state.projectRules.find((item) =>
    item.keywords
      .split(",")
      .map((keyword) => keyword.trim().toLowerCase())
      .filter(Boolean)
      .some((keyword) => haystack.includes(keyword))
  );
  return rule || { name: domainOf(tab.url || ""), color: colorForDomain(domainOf(tab.url || "")) };
};

const isStale = (tab) => {
  if (!tab.lastAccessed) return false;
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  return Date.now() - tab.lastAccessed > sevenDays;
};

const formatAge = (lastAccessed) => {
  if (!lastAccessed) return "unknown";
  const days = Math.floor((Date.now() - lastAccessed) / (24 * 60 * 60 * 1000));
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
};

const tabMatches = (tab) => {
  const query = state.query.trim().toLowerCase();
  const windowMatch = state.activeWindowId === "all" || String(tab.windowId) === String(state.activeWindowId);
  if (!query) return windowMatch;
  const project = getProject(tab).name;
  const text = `${tab.title || ""} ${tab.url || ""} ${domainOf(tab.url || "")} ${project}`.toLowerCase();
  return windowMatch && text.includes(query);
};

const visibleTabs = () => state.tabs.filter(tabMatches);

const duplicateGroups = (tabs = visibleTabs()) => {
  const grouped = new Map();
  tabs.forEach((tab) => {
    const key = normalizeUrl(tab.url);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(tab);
  });
  return Array.from(grouped.values()).filter((items) => items.length > 1);
};

const windowLabel = (windowId) => {
  const index = state.windows.findIndex((item) => item.id === windowId);
  return index >= 0 ? `Window ${index + 1}` : `Window ${windowId}`;
};

const smartStacks = () => {
  const stacks = new Map();
  visibleTabs().forEach((tab) => {
    const project = getProject(tab);
    if (!stacks.has(project.name)) {
      stacks.set(project.name, { title: project.name, color: project.color, tabs: [] });
    }
    stacks.get(project.name).tabs.push(tab);
  });
  return Array.from(stacks.values())
    .sort((a, b) => b.tabs.length - a.tabs.length || a.title.localeCompare(b.title));
};

const toast = (text) => {
  els.message.textContent = text;
  els.message.classList.add("is-visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.message.classList.remove("is-visible"), 3200);
};

const load = async () => {
  const [tabs, windows, groups, saved] = await Promise.all([
    tabsQuery({}),
    windowsGetAll(),
    tabGroupsQuery(),
    storageGet({ sessions: [], projectRules: [] })
  ]);

  const groupLookup = new Map(groups.map((group) => [group.id, group]));
  state.tabs = tabs
    .filter((tab) => tab.url && !tab.url.startsWith(chrome.runtime.getURL("")))
    .map((tab) => ({ ...tab, group: groupLookup.get(tab.groupId) || null }));
  state.windows = windows;
  state.sessions = saved.sessions;
  state.projectRules = saved.projectRules;
  state.selected = new Set([...state.selected].filter((id) => state.tabs.some((tab) => tab.id === id)));

  render();
};

const render = () => {
  els.tabCount.textContent = state.tabs.length;
  els.windowCount.textContent = state.windows.length;
  els.duplicateCount.textContent = duplicateGroups(state.tabs).reduce((sum, group) => sum + group.length - 1, 0);
  els.staleCount.textContent = state.tabs.filter(isStale).length;
  renderWindows();
  renderTabs();
  renderClusters();
  renderDuplicates();
  renderSweep();
  renderSessions();
  renderRules();
};

const renderWindows = () => {
  const counts = new Map();
  state.tabs.forEach((tab) => counts.set(tab.windowId, (counts.get(tab.windowId) || 0) + 1));
  const items = [
    `<button class="window-item ${state.activeWindowId === "all" ? "is-active" : ""}" data-window="all" type="button"><span>All windows</span><strong>${state.tabs.length}</strong></button>`,
    ...state.windows.map((window, index) => `
      <button class="window-item ${String(state.activeWindowId) === String(window.id) ? "is-active" : ""}" data-window="${window.id}" data-drop-window="${window.id}" type="button">
        <span>Window ${index + 1}</span>
        <strong>${counts.get(window.id) || 0}</strong>
      </button>
    `)
  ];
  els.windowList.innerHTML = items.join("");
};

const renderTabs = () => {
  const tabs = visibleTabs();
  if (!tabs.length) {
    els.tabList.innerHTML = `<div class="empty-state">No matching tabs.</div>`;
    return;
  }

  const byWindow = new Map();
  tabs.forEach((tab) => {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  });

  els.tabList.innerHTML = Array.from(byWindow.entries()).map(([windowId, windowTabs]) => `
    <section class="window-section" data-drop-window="${windowId}">
      <div class="window-heading">
        <h3>${windowLabel(windowId)}</h3>
        <div class="window-actions">
          ${windowSelectButton(windowId, windowTabs)}
          <button class="danger-subtle" data-close-window-tabs="${windowId}" type="button">Close tabs</button>
        </div>
      </div>
      ${windowTabs.map(tabRow).join("")}
    </section>
  `).join("");
};

const windowSelectButton = (windowId, windowTabs) => {
  const allSelected = windowTabs.every((tab) => state.selected.has(tab.id));
  const selectedCount = windowTabs.filter((tab) => state.selected.has(tab.id)).length;
  const label = allSelected ? "Unselect window" : selectedCount ? `Select rest (${selectedCount}/${windowTabs.length})` : "Select window";
  const action = allSelected ? "unselect" : "select";
  return `<button data-toggle-window="${windowId}" data-window-action="${action}" type="button">${label}</button>`;
};

const tabRow = (tab) => {
  const project = getProject(tab);
  const selected = state.selected.has(tab.id);
  const flags = [
    tab.pinned ? `<span class="chip">Pinned</span>` : "",
    tab.audible ? `<span class="chip">Audio</span>` : "",
    isStale(tab) ? `<span class="chip warning">Stale ${formatAge(tab.lastAccessed)}</span>` : "",
    tab.group ? `<span class="chip">${escapeHtml(tab.group.title || "Grouped")}</span>` : ""
  ].join("");

  return `
    <article class="tab-row ${selected ? "is-selected" : ""}" data-tab="${tab.id}" draggable="true">
      <label class="check">
        <input type="checkbox" data-select-tab="${tab.id}" ${selected ? "checked" : ""}>
      </label>
      ${tab.favIconUrl ? `<img class="favicon" src="${escapeHtml(tab.favIconUrl)}" alt="">` : `<span class="favicon" aria-hidden="true"></span>`}
      <div class="tab-main">
        <button class="link-button" data-focus-tab="${tab.id}" type="button">${escapeHtml(tab.title || "Untitled tab")}</button>
        <p>${escapeHtml(domainOf(tab.url || ""))}</p>
      </div>
      <span class="project-pill ${project.color}">${escapeHtml(project.name)}</span>
      <div class="tab-flags">${flags}</div>
      <button class="row-close-button" data-close-tab="${tab.id}" title="Close tab" type="button">×</button>
    </article>
  `;
};

const renderClusters = () => {
  const stacks = smartStacks();
  const duplicates = duplicateGroups();
  const stale = visibleTabs().filter(isStale);
  const special = [
    duplicates.length
      ? {
          title: "Duplicates",
          color: "red",
          tabs: duplicates.flatMap((group) => group.slice(1)),
          note: "Close the extras after checking the first copy."
        }
      : null,
    stale.length
      ? {
          title: "Stale tabs",
          color: "yellow",
          tabs: stale,
          note: "Tabs untouched for more than a week."
        }
      : null
  ].filter(Boolean);

  els.clusterList.innerHTML = [...special, ...stacks].map((stack) => `
    <article class="cluster-card">
      <div class="cluster-head">
        <span class="color-dot ${stack.color}"></span>
        <div>
          <h3>${escapeHtml(stack.title)}</h3>
          <p>${stack.tabs.length} tabs${stack.note ? ` · ${escapeHtml(stack.note)}` : ""}</p>
        </div>
      </div>
      <div class="cluster-actions">
        <button data-select-stack="${escapeHtml(stack.title)}" type="button">Select</button>
        <button data-group-stack="${escapeHtml(stack.title)}" type="button">Group</button>
        <button data-export-stack="${escapeHtml(stack.title)}" type="button">Export</button>
      </div>
      <div class="mini-list">
        ${stack.tabs.slice(0, 8).map((tab) => `<button data-focus-tab="${tab.id}" type="button">${escapeHtml(tab.title || domainOf(tab.url))}</button>`).join("")}
      </div>
    </article>
  `).join("") || `<div class="empty-state">No stacks yet.</div>`;
};

const renderDuplicates = () => {
  const groups = duplicateGroups().sort((a, b) => b.length - a.length || domainOf(a[0].url).localeCompare(domainOf(b[0].url)));
  if (!groups.length) {
    els.duplicateList.innerHTML = `<div class="empty-state">No duplicate tabs found.</div>`;
    return;
  }

  els.duplicateList.innerHTML = groups.map((group) => {
    const canonical = normalizeUrl(group[0].url);
    return `
      <article class="duplicate-card">
        <div class="duplicate-head">
          <div>
            <h3>${escapeHtml(domainOf(group[0].url))}</h3>
            <p>${group.length} copies · ${escapeHtml(canonical)}</p>
          </div>
          <div class="cluster-actions">
            <button data-select-duplicate-group="${escapeHtml(canonical)}" type="button">Select all</button>
            <button data-select-duplicate-extras="${escapeHtml(canonical)}" type="button">Select extras</button>
            <button data-export-duplicate-group="${escapeHtml(canonical)}" type="button">Export</button>
          </div>
        </div>
        <div class="duplicate-tabs">
          ${group.map((tab, index) => duplicateRow(tab, index)).join("")}
        </div>
      </article>
    `;
  }).join("");
};

const duplicateRow = (tab, index) => {
  const selected = state.selected.has(tab.id);
  return `
    <article class="duplicate-row ${selected ? "is-selected" : ""}">
      <label class="check">
        <input type="checkbox" data-select-tab="${tab.id}" ${selected ? "checked" : ""}>
      </label>
      <div class="tab-main">
        <button class="link-button" data-focus-tab="${tab.id}" type="button">${escapeHtml(tab.title || "Untitled tab")}</button>
        <p>${escapeHtml(windowLabel(tab.windowId))} · ${index === 0 ? "first copy" : "extra copy"} · last used ${formatAge(tab.lastAccessed)}</p>
      </div>
      <button class="row-close-button" data-close-tab="${tab.id}" title="Close tab" type="button">×</button>
    </article>
  `;
};

const renderSweep = () => {
  const tabs = visibleTabs().sort((a, b) => {
    if (isStale(a) !== isStale(b)) return isStale(a) ? -1 : 1;
    return (a.lastAccessed || 0) - (b.lastAccessed || 0);
  });

  els.sweepList.innerHTML = tabs.map((tab) => {
    const decision = state.sweep.get(tab.id) || "keep";
    return `
      <article class="sweep-row ${decision}" data-tab="${tab.id}">
        <div>
          <h3>${escapeHtml(tab.title || "Untitled tab")}</h3>
          <p>${escapeHtml(domainOf(tab.url || ""))} · last used ${formatAge(tab.lastAccessed)}</p>
        </div>
        <div class="segmented" role="group" aria-label="Sweep decision">
          <button class="${decision === "keep" ? "is-active" : ""}" data-sweep="${tab.id}:keep" type="button">Keep</button>
          <button class="${decision === "save" ? "is-active" : ""}" data-sweep="${tab.id}:save" type="button">Save</button>
          <button class="${decision === "close" ? "is-active" : ""}" data-sweep="${tab.id}:close" type="button">Close</button>
        </div>
      </article>
    `;
  }).join("") || `<div class="empty-state">No tabs to sweep.</div>`;
};

const renderSessions = () => {
  els.sessionList.innerHTML = state.sessions.map((session) => `
    <article class="session-card">
      <div>
        <h3>${escapeHtml(session.name)}</h3>
        <p>${session.tabs.length} tabs · ${new Date(session.createdAt).toLocaleString()}</p>
      </div>
      <div class="session-actions">
        <button data-restore-session="${session.id}" type="button">Restore</button>
        <button data-export-session="${session.id}" type="button">Export</button>
        <button data-delete-session="${session.id}" class="danger-subtle" type="button">Delete</button>
      </div>
    </article>
  `).join("") || `<div class="empty-state">No saved sessions yet.</div>`;
};

const renderRules = () => {
  els.ruleList.innerHTML = state.projectRules.map((rule, index) => `
    <article class="rule-row">
      <span class="color-dot ${rule.color}"></span>
      <div>
        <h3>${escapeHtml(rule.name)}</h3>
        <p>${escapeHtml(rule.keywords)}</p>
      </div>
      <button class="danger-subtle" data-delete-rule="${index}" type="button">Delete</button>
    </article>
  `).join("") || `<div class="empty-state">No rules yet.</div>`;
};

const selectedTabs = () => state.tabs.filter((tab) => state.selected.has(tab.id));

const saveSession = async (tabs, name = null) => {
  if (!tabs.length) {
    toast("Select at least one tab first.");
    return null;
  }
  const session = {
    id: crypto.randomUUID(),
    name: name || `Session ${new Date().toLocaleString()}`,
    createdAt: Date.now(),
    tabs: tabs.map((tab) => ({
      title: tab.title || tab.url,
      url: tab.url,
      windowId: tab.windowId,
      project: getProject(tab).name
    }))
  };
  state.sessions = [session, ...state.sessions].slice(0, 100);
  await storageSet({ sessions: state.sessions });
  renderSessions();
  toast(`Saved ${tabs.length} tabs.`);
  return session;
};

const bookmarkHtml = (tabs, title = "Tab Atelier Export") => {
  const byProject = new Map();
  tabs.forEach((tab) => {
    const project = getProject(tab).name;
    if (!byProject.has(project)) byProject.set(project, []);
    byProject.get(project).push(tab);
  });

  const folders = Array.from(byProject.entries()).map(([project, items]) => `
    <DT><H3>${escapeHtml(project)}</H3>
    <DL><p>
      ${items.map((tab) => `<DT><A HREF="${escapeHtml(tab.url)}">${escapeHtml(tab.title || tab.url)}</A>`).join("\n")}
    </DL><p>
  `).join("\n");

  return `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>${escapeHtml(title)}</TITLE>
<H1>${escapeHtml(title)}</H1>
<DL><p>
${folders}
</DL><p>`;
};

const exportTabs = (tabs, label = "tab-atelier-export") => {
  if (!tabs.length) {
    toast("Nothing to export.");
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`${label}-${stamp}.html`, bookmarkHtml(tabs, label));
  toast("Bookmark file ready for Raindrop import.");
};

const copyUrls = async (tabs) => {
  if (!tabs.length) {
    toast("Select at least one tab first.");
    return;
  }
  try {
    await navigator.clipboard.writeText(tabs.map((tab) => tab.url).join("\n"));
    toast(`Copied ${tabs.length} URLs.`);
  } catch (error) {
    toast(`Could not copy: ${error.message}`);
  }
};

const focusTab = async (tabId) => {
  const tab = state.tabs.find((item) => item.id === Number(tabId));
  if (!tab) return;
  await updateWindow(tab.windowId, { focused: true });
  await updateTab(tab.id, { active: true });
};

// Asks before closing more than one tab, and calls out selected tabs the current filter hides.
const confirmClose = (tabs) => {
  if (tabs.length < 2) return true;
  const hidden = tabs.filter((tab) => !tabMatches(tab)).length;
  const note = hidden ? `\n\n${hidden} of them ${hidden === 1 ? "is" : "are"} hidden by the current search or window filter.` : "";
  return window.confirm(`Close ${tabs.length} tabs?${note}`);
};

// Returns how many tabs were closed. If the bulk call fails (e.g. a tab already closed), falls back to one at a time.
const closeTabs = async (tabs, { confirm = true } = {}) => {
  if (!tabs.length) {
    toast("Select tabs to close.");
    return 0;
  }
  if (confirm && !confirmClose(tabs)) return 0;

  let closed = tabs.length;
  try {
    await removeTabs(tabs.map((tab) => tab.id));
  } catch {
    closed = 0;
    for (const tab of tabs) {
      try {
        await removeTabs(tab.id);
        closed += 1;
      } catch {
        // Already gone or not closable; the reload below drops it from the list.
      }
    }
  }
  tabs.forEach((tab) => state.selected.delete(tab.id));
  await load();
  toast(closed === tabs.length ? `Closed ${closed} tabs.` : `Closed ${closed} of ${tabs.length} tabs.`);
  return closed;
};

const closeWindowTabs = async (windowId) => {
  const tabs = state.tabs.filter((tab) => String(tab.windowId) === String(windowId));
  if (!tabs.length) {
    toast("No tabs to close in that window.");
    return;
  }
  if (!window.confirm(`Close all ${tabs.length} tabs in ${windowLabel(Number(windowId))}? The window will close if nothing else is open in it.`)) return;

  await closeTabs(tabs, { confirm: false });
};

const groupSelected = async () => {
  const tabs = selectedTabs();
  if (!tabs.length) {
    toast("Select tabs to group.");
    return;
  }
  const project = getProject(tabs[0]);
  const grouped = await groupTabSet(tabs, project.name, project.color);
  await load();
  toast(groupedMessage(grouped, tabs.length, ` as ${project.name}`));
};

// Puts each saved window's tabs back in their own window. A single-window session opens in the current window.
const restoreSession = async (session) => {
  const tabs = session.tabs.filter((tab) => isRestorableUrl(tab.url));
  const byWindow = new Map();
  tabs.forEach((tab) => {
    const key = tab.windowId ?? "none";
    if (!byWindow.has(key)) byWindow.set(key, []);
    byWindow.get(key).push(tab.url);
  });

  let opened = 0;
  if (byWindow.size === 1) {
    for (const url of tabs.map((tab) => tab.url)) {
      if (await createTab(url)) opened += 1;
    }
  } else {
    for (const urls of byWindow.values()) {
      if (await createWindow(urls)) {
        opened += urls.length;
      } else {
        for (const url of urls) {
          if (await createTab(url)) opened += 1;
        }
      }
    }
  }

  const skipped = session.tabs.length - opened;
  toast(`Restored ${opened} tabs.${skipped ? ` Skipped ${skipped} that the browser won't let extensions open.` : ""}`);
};

const stackByTitle = (title) =>
  [
    ...smartStacks(),
    {
      title: "Duplicates",
      color: "red",
      tabs: duplicateGroups().flatMap((group) => group.slice(1))
    },
    {
      title: "Stale tabs",
      color: "yellow",
      tabs: visibleTabs().filter(isStale)
    }
  ].find((stack) => stack.title === title);

const duplicateGroupByUrl = (url) =>
  duplicateGroups().find((group) => normalizeUrl(group[0].url) === url);

const clearDropTargets = () => {
  $$("[data-drop-window].is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
};

const dropTargetFrom = (event) => {
  const target = event.target.closest("[data-drop-window]");
  if (!target || target.dataset.dropWindow === "all") return null;
  return target;
};

document.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".tab-row[data-tab]");
  if (!row) return;

  if (event.target.closest("input, label, [data-close-tab]")) {
    event.preventDefault();
    return;
  }

  state.draggingTabId = Number(row.dataset.tab);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-tab-atelier-tab", String(state.draggingTabId));
  event.dataTransfer.setData("text/plain", String(state.draggingTabId));
  window.requestAnimationFrame(() => row.classList.add("is-dragging"));
});

document.addEventListener("dragover", (event) => {
  const target = dropTargetFrom(event);
  const tab = state.tabs.find((item) => item.id === state.draggingTabId);
  if (!target || !tab || String(tab.windowId) === target.dataset.dropWindow) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  clearDropTargets();
  target.classList.add("is-drop-target");
});

document.addEventListener("dragleave", (event) => {
  const target = dropTargetFrom(event);
  if (target && !target.contains(event.relatedTarget)) {
    target.classList.remove("is-drop-target");
  }
});

document.addEventListener("dragend", () => {
  state.draggingTabId = null;
  $$(".tab-row.is-dragging").forEach((row) => row.classList.remove("is-dragging"));
  clearDropTargets();
});

document.addEventListener("drop", async (event) => {
  const target = dropTargetFrom(event);
  const tabId = Number(event.dataTransfer.getData("application/x-tab-atelier-tab") || state.draggingTabId);
  const tab = state.tabs.find((item) => item.id === tabId);
  if (!target || !tab) return;

  event.preventDefault();
  clearDropTargets();

  const targetWindowId = Number(target.dataset.dropWindow);
  if (tab.windowId === targetWindowId) return;

  try {
    await moveTabToWindow(tab.id, targetWindowId);
    await load();
    toast(`Moved tab to ${windowLabel(targetWindowId)}.`);
  } catch (error) {
    toast(error.message || "Could not move that tab.");
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, input[type='checkbox']");
  if (!target) return;

  if (target.matches("[data-window]")) {
    state.activeWindowId = target.dataset.window;
    render();
  }

  if (target.matches("[data-select-tab]")) {
    const tabId = Number(target.dataset.selectTab);
    target.checked ? state.selected.add(tabId) : state.selected.delete(tabId);
    render();
  }

  if (target.matches("[data-focus-tab]")) {
    await focusTab(target.dataset.focusTab);
  }

  if (target.matches("[data-close-tab]")) {
    const tab = state.tabs.find((item) => item.id === Number(target.dataset.closeTab));
    if (tab) await closeTabs([tab]);
  }

  if (target.matches("[data-toggle-window]")) {
    const tabs = visibleTabs().filter((tab) => String(tab.windowId) === target.dataset.toggleWindow);
    tabs.forEach((tab) => {
      if (target.dataset.windowAction === "unselect") {
        state.selected.delete(tab.id);
      } else {
        state.selected.add(tab.id);
      }
    });
    render();
  }

  if (target.matches("[data-close-window-tabs]")) {
    await closeWindowTabs(target.dataset.closeWindowTabs);
  }

  if (target.matches("[data-select-stack]")) {
    const stack = stackByTitle(target.dataset.selectStack);
    stack?.tabs.forEach((tab) => state.selected.add(tab.id));
    render();
  }

  if (target.matches("[data-group-stack]")) {
    const stack = stackByTitle(target.dataset.groupStack);
    if (stack?.tabs.length) {
      const grouped = await groupTabSet(stack.tabs, stack.title, stack.color);
      await load();
      toast(groupedMessage(grouped, stack.tabs.length));
    }
  }

  if (target.matches("[data-export-stack]")) {
    const stack = stackByTitle(target.dataset.exportStack);
    exportTabs(stack?.tabs || [], target.dataset.exportStack.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  }

  if (target.matches("[data-select-duplicate-group]")) {
    duplicateGroupByUrl(target.dataset.selectDuplicateGroup)?.forEach((tab) => state.selected.add(tab.id));
    render();
  }

  if (target.matches("[data-select-duplicate-extras]")) {
    duplicateGroupByUrl(target.dataset.selectDuplicateExtras)?.slice(1).forEach((tab) => state.selected.add(tab.id));
    render();
  }

  if (target.matches("[data-export-duplicate-group]")) {
    const group = duplicateGroupByUrl(target.dataset.exportDuplicateGroup) || [];
    exportTabs(group, `duplicates-${domainOf(group[0]?.url || "tabs")}`);
  }

  if (target.matches("[data-sweep]")) {
    const [id, decision] = target.dataset.sweep.split(":");
    state.sweep.set(Number(id), decision);
    renderSweep();
  }

  if (target.matches("[data-restore-session]")) {
    const session = state.sessions.find((item) => item.id === target.dataset.restoreSession);
    if (session) await restoreSession(session);
  }

  if (target.matches("[data-export-session]")) {
    const session = state.sessions.find((item) => item.id === target.dataset.exportSession);
    if (session) exportTabs(session.tabs.map((tab) => ({ ...tab, id: 0 })), session.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
  }

  if (target.matches("[data-delete-session]")) {
    state.sessions = state.sessions.filter((item) => item.id !== target.dataset.deleteSession);
    await storageSet({ sessions: state.sessions });
    renderSessions();
    toast("Deleted session.");
  }

  if (target.matches("[data-delete-rule]")) {
    state.projectRules.splice(Number(target.dataset.deleteRule), 1);
    await storageSet({ projectRules: state.projectRules });
    render();
  }
});

$$(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.activeView = button.dataset.view;
    $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item === button));
    $$(".view").forEach((view) => view.classList.remove("is-visible"));
    $(`#view${state.activeView[0].toUpperCase()}${state.activeView.slice(1)}`).classList.add("is-visible");
  });
});

$("#refreshButton").addEventListener("click", load);
$("#saveSelectedButton").addEventListener("click", () => saveSession(selectedTabs()));
$("#saveAllButton").addEventListener("click", () => saveSession(state.tabs, "All open tabs"));
$("#exportSelectedButton").addEventListener("click", () => exportTabs(selectedTabs()));
$("#copySelectedButton").addEventListener("click", () => copyUrls(selectedTabs()));
$("#closeSelectedButton").addEventListener("click", () => closeTabs(selectedTabs()));
$("#groupSelectedButton").addEventListener("click", groupSelected);
$("#groupAllStacksButton").addEventListener("click", async () => {
  const stacks = smartStacks().filter((item) => item.tabs.length > 1);
  let grouped = 0;
  for (const stack of stacks) {
    grouped += await groupTabSet(stack.tabs, stack.title, stack.color);
  }
  await load();
  toast(groupedMessage(grouped, stacks.reduce((sum, stack) => sum + stack.tabs.length, 0), " from the visible stacks"));
});
$("#selectDuplicateExtrasButton").addEventListener("click", () => {
  duplicateGroups().forEach((group) => group.slice(1).forEach((tab) => state.selected.add(tab.id)));
  render();
  toast("Selected the extra copies from every duplicate group.");
});

$("#saveAndCloseSweepButton").addEventListener("click", async () => {
  const save = state.tabs.filter((tab) => state.sweep.get(tab.id) === "save");
  const close = state.tabs.filter((tab) => state.sweep.get(tab.id) === "close" || state.sweep.get(tab.id) === "save");
  if (!close.length) {
    toast("Mark tabs as Save or Close first.");
    return;
  }
  if (!window.confirm(`Save ${save.length} tabs as a session, then close ${close.length} tabs?`)) return;
  if (save.length) await saveSession(save, `Sweep ${new Date().toLocaleString()}`);
  const closed = await closeTabs(close, { confirm: false });
  state.sweep.clear();
  toast(`Swept ${closed} tabs.`);
});

// Inline onerror handlers are blocked by the extension CSP, so broken favicons are hidden here instead.
document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.matches(".favicon")) {
    event.target.style.visibility = "hidden";
  }
}, true);

$("#ruleForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.projectRules.push({
    name: $("#ruleName").value.trim(),
    keywords: $("#ruleKeywords").value.trim(),
    color: $("#ruleColor").value
  });
  await storageSet({ projectRules: state.projectRules });
  event.target.reset();
  render();
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  render();
});

load();
