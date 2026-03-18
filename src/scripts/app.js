import { computeInstagramDiffs, parseInstagramExportZip } from '../lib/instagram-export';

const VIEW = {
  summary: 'summary',
  notFollowingBack: 'not-following-back',
  fans: 'fans',
  unfollowed: 'unfollowed',
};

function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function userUrl(user) {
  if (user?.href && typeof user.href === 'string') return user.href;
  return `https://www.instagram.com/${encodeURIComponent(user.username)}/`;
}

const STATUS = ['open', 'in progress', 'on hold', 'attention requred', 'done'];
const STATUS_ALIASES = {
  'attention required': 'attention requred',
};

const STATUS_LABELS = {
  open: 'Open',
  'in progress': 'In progress',
  'on hold': 'On hold',
  'attention requred': 'Attention required',
  done: 'Done',
};

const INSTACHECK_STORAGE_PREFIX = 'instacheck:';
const LOCAL_STORAGE_EXPORT_VERSION = 1;

function storageKey(kind, username) {
  return `${INSTACHECK_STORAGE_PREFIX}${kind}:${username.toLowerCase()}`;
}

function readStatus(kind, username) {
  try {
    const raw = localStorage.getItem(storageKey(kind, username));
    if (!raw) return 'open';
    const normalized = STATUS_ALIASES[raw] ?? raw;
    if (STATUS.includes(normalized)) return normalized;
  } catch {
    // ignore
  }
  return 'open';
}

function writeStatus(kind, username, status) {
  const normalized = STATUS_ALIASES[status] ?? status;
  if (normalized === 'open') {
    try {
      localStorage.removeItem(storageKey(kind, username));
    } catch {
      // ignore
    }
    return;
  }
  try {
    localStorage.setItem(storageKey(kind, username), normalized);
  } catch {
    // ignore
  }
}

function isPlainRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getInstacheckStatusEntries() {
  const entries = {};
  const prefix = INSTACHECK_STORAGE_PREFIX;

  let length;
  try {
    length = localStorage.length;
  } catch (cause) {
    throw new Error('Could not access localStorage.', { cause });
  }

  for (let i = 0; i < length; i++) {
    let key;
    try {
      key = localStorage.key(i);
    } catch (cause) {
      throw new Error('Could not enumerate localStorage keys.', { cause });
    }

    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;

    let value;
    try {
      value = localStorage.getItem(key);
    } catch (cause) {
      throw new Error(`Could not read localStorage item: ${key}`, { cause });
    }

    if (typeof value === 'string') entries[key] = value;
  }

  return entries;
}

function downloadJson(filename, payload) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractEntriesFromExportPayload(payload) {
  if (!isPlainRecord(payload)) {
    throw new Error('Invalid import payload: expected a JSON object.');
  }

  if (isPlainRecord(payload.entries)) return payload.entries;

  // Tolerate a few alternative shapes (in case users paste JSON manually).
  if (isPlainRecord(payload.data)) return payload.data;

  const keys = Object.keys(payload);
  if (keys.length > 0 && keys.every((k) => k.startsWith(INSTACHECK_STORAGE_PREFIX))) return payload;

  throw new Error('Unsupported import payload: expected an `entries` object with instacheck keys.');
}

function parseInstacheckExportPayload(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (cause) {
    throw new Error('Invalid JSON import.', { cause });
  }

  const entries = extractEntriesFromExportPayload(parsed);
  if (!isPlainRecord(entries)) {
    throw new Error('Invalid import payload: `entries` must be an object.');
  }

  return entries;
}

function parseInstacheckStorageKey(key) {
  if (typeof key !== 'string' || !key.startsWith(INSTACHECK_STORAGE_PREFIX)) return null;
  const rest = key.slice(INSTACHECK_STORAGE_PREFIX.length);
  const parts = rest.split(':');
  if (parts.length !== 2) return null;

  const [kind, usernameRaw] = parts;
  if (!kind || !usernameRaw) return null;

  return { kind, username: usernameRaw.toLowerCase() };
}

function removeInstacheckStatusEntries() {
  const prefix = INSTACHECK_STORAGE_PREFIX;
  let removedCount = 0;

  let length;
  try {
    length = localStorage.length;
  } catch (cause) {
    throw new Error('Could not access localStorage.', { cause });
  }

  // Iterate backwards: safe while mutating localStorage.
  for (let i = length - 1; i >= 0; i--) {
    let key;
    try {
      key = localStorage.key(i);
    } catch (cause) {
      throw new Error('Could not enumerate localStorage keys.', { cause });
    }

    if (typeof key !== 'string' || !key.startsWith(prefix)) continue;

    try {
      localStorage.removeItem(key);
      removedCount += 1;
    } catch (cause) {
      throw new Error(`Could not remove localStorage item: ${key}`, { cause });
    }
  }

  return removedCount;
}

function buildInstacheckImportOperations(entries) {
  const operations = [];
  const invalidReasons = [];

  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') {
      invalidReasons.push(`non-string value for ${key}`);
      continue;
    }

    const parsedKey = parseInstacheckStorageKey(key);
    if (!parsedKey) {
      invalidReasons.push(`invalid storage key ${key}`);
      continue;
    }

    const normalizedStatus = STATUS_ALIASES[value] ?? value;
    if (!STATUS.includes(normalizedStatus)) {
      invalidReasons.push(`invalid status "${value}" for ${key}`);
      continue;
    }

    operations.push({
      kind: parsedKey.kind,
      username: parsedKey.username,
      status: normalizedStatus,
    });
  }

  if (invalidReasons.length > 0) {
    throw new Error(
      `Import contains invalid entries (${invalidReasons.length}). Example: ${invalidReasons[0]}.`,
    );
  }

  return operations;
}

function importInstacheckStatusEntries(entries, { replaceExisting }) {
  const operations = buildInstacheckImportOperations(entries);
  const removedExistingCount = replaceExisting ? removeInstacheckStatusEntries() : 0;

  for (const op of operations) {
    writeStatus(op.kind, op.username, op.status);
  }

  return { importedCount: operations.length, removedExistingCount };
}

function refreshAllStatusWidgets() {
  document.querySelectorAll('.status').forEach((statusRoot) => {
    const kind = statusRoot.getAttribute('data-kind');
    const username = statusRoot.getAttribute('data-username');
    if (!kind || !username) return;

    const current = readStatus(kind, username);
    statusRoot.setAttribute('data-status', current);

    const labelEl = statusRoot.querySelector('.status__label');
    if (labelEl) labelEl.textContent = STATUS_LABELS[current] ?? current;

    statusRoot.querySelectorAll('[data-status-option]').forEach((optionBtn) => {
      const option = optionBtn.getAttribute('data-status-option');
      optionBtn.setAttribute('aria-selected', String(option === current));
    });
  });
}

function renderUserList(container, users, kind) {
  const itemsHtml = users
    .map((u) => {
      const current = readStatus(kind, u.username);
      return `
      <li class="user">
        <a class="user__link" href="${escapeHtml(userUrl(u))}" target="_blank" rel="noreferrer noopener">
          <span class="user__handle">@${escapeHtml(u.username)}</span>
        </a>
        <div class="status" data-kind="${escapeHtml(kind)}" data-username="${escapeHtml(u.username)}" data-status="${escapeHtml(current)}">
          <button type="button" class="status__current" data-status-current aria-haspopup="listbox" aria-expanded="false">
            <span class="status__label">${escapeHtml(STATUS_LABELS[current] ?? current)}</span>
            <span class="status__caret" aria-hidden="true"></span>
          </button>
          <div class="status__menu" role="listbox" aria-label="Status" hidden>
            ${STATUS.map((s) => {
              const selected = s === current ? 'true' : 'false';
              return `<button type="button" class="status__option" role="option" aria-selected="${selected}" data-status-option="${escapeHtml(s)}">${escapeHtml(
                STATUS_LABELS[s] ?? s,
              )}</button>`;
            }).join('')}
          </div>
        </div>
      </li>
    `;
    })
    .join('');

  container.innerHTML = itemsHtml;
}

function setError(message) {
  const errorEl = document.querySelector('[data-error]');
  if (!errorEl) return;
  errorEl.textContent = message ?? '';
  errorEl.toggleAttribute('data-has-error', Boolean(message));
}

function setStatus(message) {
  const statusEl = document.querySelector('[data-status]');
  if (!statusEl) return;
  statusEl.textContent = message ?? '';
}

function setActiveView(view) {
  const root = document.querySelector('[data-app-root]');
  if (!root) return;
  root.setAttribute('data-view', view);

  document.querySelectorAll('[data-nav-link]').forEach((a) => {
    const v = a.getAttribute('data-nav-link');
    if (v === view) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
}

function setCounts({ followersCount, followingCount, mutualCount }) {
  const followersEl = document.querySelector('[data-count="followers"]');
  const followingEl = document.querySelector('[data-count="following"]');
  const mutualEl = document.querySelector('[data-count="mutual"]');

  if (followersEl) followersEl.textContent = String(followersCount);
  if (followingEl) followingEl.textContent = String(followingCount);
  if (mutualEl) mutualEl.textContent = String(mutualCount);
}

function setListCounts({ notFollowingBackCount, fansCount, unfollowedCount }) {
  const notBackEl = document.querySelector('[data-count="not-following-back"]');
  const fansEl = document.querySelector('[data-count="fans"]');
  const unfollowedEl = document.querySelector('[data-count="unfollowed"]');
  if (notBackEl) notBackEl.textContent = String(notFollowingBackCount);
  if (fansEl) fansEl.textContent = String(fansCount);
  if (unfollowedEl) unfollowedEl.textContent = String(unfollowedCount);
}

function updateHash(view) {
  const next = `#${view}`;
  if (location.hash === next) return;
  // Use location.hash so browsers consistently update navigation state.
  location.hash = next;
}

function getViewFromHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  if (raw === VIEW.notFollowingBack) return VIEW.notFollowingBack;
  if (raw === VIEW.fans) return VIEW.fans;
  if (raw === VIEW.unfollowed) return VIEW.unfollowed;
  return VIEW.summary;
}

async function run() {
  const fileInput = document.querySelector('input[type="file"][data-zip-input]');
  const resultsRoot = document.querySelector('[data-results]');
  const notBackList = document.querySelector('[data-list="not-following-back"]');
  const fansList = document.querySelector('[data-list="fans"]');
  const unfollowedList = document.querySelector('[data-list="unfollowed"]');

  if (!fileInput || !resultsRoot || !notBackList || !fansList || !unfollowedList) return;

  const exportMapButton = document.querySelector('button[data-export-map]');
  const importMapFileInput = document.querySelector('input[type="file"][data-import-map-file-input]');
  const importMapFromTextButton = document.querySelector('button[data-import-map-from-text]');
  const importMapReplaceCheckbox = document.querySelector('input[type="checkbox"][data-import-map-replace-checkbox]');

  setActiveView(getViewFromHash());
  window.addEventListener('hashchange', () => setActiveView(getViewFromHash()));

  function closeAllStatusMenus() {
    document.querySelectorAll('.status__menu').forEach((menu) => {
      menu.hidden = true;
    });
    document.querySelectorAll('[data-status-current]').forEach((btn) => {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  if (exportMapButton) {
    exportMapButton.addEventListener('click', () => {
      setError('');
      try {
        setStatus('Preparing export...');

        const entries = getInstacheckStatusEntries();
        const entryCount = Object.keys(entries).length;

        const now = new Date();
        const datePart = now.toISOString().slice(0, 10);
        const filename = `instacheck-status-map-${datePart}.json`;

        downloadJson(filename, {
          version: LOCAL_STORAGE_EXPORT_VERSION,
          prefix: INSTACHECK_STORAGE_PREFIX,
          exportedAt: now.toISOString(),
          entries,
        });

        setStatus(`Exported ${entryCount} status entr${entryCount === 1 ? 'y' : 'ies'}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('');
      }
    });
  }

  if (importMapFileInput) {
    importMapFileInput.addEventListener('change', async () => {
      setError('');
      setStatus('');

      const file = importMapFileInput.files?.[0];
      if (!file) return;

      try {
        setStatus('Reading import JSON...');

        const rawText = await file.text();
        const entries = parseInstacheckExportPayload(rawText);
        const replaceExisting = importMapReplaceCheckbox?.checked ?? true;

        const { importedCount } = importInstacheckStatusEntries(entries, { replaceExisting });
        refreshAllStatusWidgets();
        closeAllStatusMenus();

        importMapFileInput.value = '';
        setStatus(`Imported ${importedCount} status entr${importedCount === 1 ? 'y' : 'ies'}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('');
      }
    });
  }

  if (importMapFromTextButton && importMapFileInput) {
    importMapFromTextButton.addEventListener('click', () => {
      // Reuse the file picker flow.
      setError('');
      setStatus('');
      importMapFileInput.click();
    });
  }

  document.addEventListener('click', (e) => {
    const statusRoot = e.target.closest('.status');
    if (!statusRoot) closeAllStatusMenus();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllStatusMenus();
  });

  document.addEventListener('click', (e) => {
    const currentBtn = e.target.closest('[data-status-current]');
    if (currentBtn) {
      const root = currentBtn.closest('.status');
      if (!root) return;

      const menu = root.querySelector('.status__menu');
      if (!menu) return;

      const isCurrentlyOpen = !menu.hidden;
      closeAllStatusMenus();
      if (!isCurrentlyOpen) {
        menu.hidden = false;
        currentBtn.setAttribute('aria-expanded', 'true');
      } else {
        currentBtn.setAttribute('aria-expanded', 'false');
      }
      e.stopPropagation();
      return;
    }

    const optionBtn = e.target.closest('[data-status-option]');
    if (optionBtn) {
      const root = optionBtn.closest('.status');
      if (!root) return;
      const kind = root.getAttribute('data-kind');
      const username = root.getAttribute('data-username');
      const nextStatusRaw = optionBtn.getAttribute('data-status-option');
      if (!kind || !username || !nextStatusRaw) return;

      const nextStatus = STATUS_ALIASES[nextStatusRaw] ?? nextStatusRaw;
      if (!STATUS.includes(nextStatus)) return;

      writeStatus(kind, username, nextStatus);

      root.setAttribute('data-status', nextStatus);
      const labelEl = root.querySelector('.status__label');
      if (labelEl) labelEl.textContent = STATUS_LABELS[nextStatus] ?? nextStatus;

      // Close menu and update ARIA selected states
      closeAllStatusMenus();

      const menu = root.querySelector('.status__menu');
      if (menu) {
        menu.querySelectorAll('[data-status-option]').forEach((btn) => {
          const v = btn.getAttribute('data-status-option');
          btn.setAttribute('aria-selected', String(v === nextStatus));
        });
      }

      e.stopPropagation();
    }
  });

  fileInput.addEventListener('change', async () => {
    setError('');
    setStatus('');
    resultsRoot.toggleAttribute('data-has-results', false);

    const file = fileInput.files?.[0];
    if (!file) return;

    setStatus('Reading zip…');
    try {
      const data = await parseInstagramExportZip(file);
      const diffs = computeInstagramDiffs(data);

      setCounts(diffs.summary);
      setListCounts({
        notFollowingBackCount: diffs.notFollowingBack.length,
        fansCount: diffs.fans.length,
        unfollowedCount: diffs.unfollowedUsers.length,
      });

      renderUserList(notBackList, diffs.notFollowingBack, 'not-following-back');
      renderUserList(fansList, diffs.fans, 'fans');
      renderUserList(unfollowedList, diffs.unfollowedUsers, 'unfollowed');

      resultsRoot.toggleAttribute('data-has-results', true);
      setStatus('Done.');

      const view = getViewFromHash();
      setActiveView(view);
      updateHash(view);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus('');
    }
  });
}

run();

