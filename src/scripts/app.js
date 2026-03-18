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

function renderUserList(container, users) {
  container.innerHTML = users
    .map(
      (u) => `
      <li class="user">
        <a class="user__link" href="${escapeHtml(userUrl(u))}" target="_blank" rel="noreferrer noopener">
          <span class="user__handle">@${escapeHtml(u.username)}</span>
        </a>
      </li>
    `,
    )
    .join('');
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

  document.querySelectorAll('[data-nav-link]').forEach((a) => {
    a.addEventListener('click', () => {
      const view = a.getAttribute('data-nav-link');
      if (!view) return;
      setActiveView(view);
    });
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

      renderUserList(notBackList, diffs.notFollowingBack);
      renderUserList(fansList, diffs.fans);
      renderUserList(unfollowedList, diffs.unfollowedUsers);

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

