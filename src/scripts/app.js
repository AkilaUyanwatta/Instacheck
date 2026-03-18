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

function storageKey(kind, username) {
  return `instacheck:${kind}:${username.toLowerCase()}`;
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

