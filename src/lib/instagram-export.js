import JSZip from 'jszip';

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function getFirstStringListEntry(value) {
  if (!isRecord(value)) return null;
  const list = value['string_list_data'];
  if (!Array.isArray(list) || list.length === 0) return null;
  const entry = list[0];
  if (!isRecord(entry)) return null;

  const href = typeof entry['href'] === 'string' ? entry['href'] : undefined;
  const usernameValue = typeof entry['value'] === 'string' ? entry['value'] : undefined;
  const timestamp = typeof entry['timestamp'] === 'number' ? entry['timestamp'] : undefined;
  return { href, value: usernameValue, timestamp };
}

function normalizeUsername(username) {
  return String(username).trim().replace(/^@/, '');
}

function parseFollowersJson(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, error: new Error('followers_1.json: expected top-level array') };
  }

  const users = [];
  for (const item of raw) {
    const entry = getFirstStringListEntry(item);
    if (!entry?.value) continue;

    users.push({
      username: normalizeUsername(entry.value),
      href: entry.href,
      timestamp: entry.timestamp,
    });
  }

  if (users.length === 0) {
    return { ok: false, error: new Error('followers_1.json: no users found (unexpected shape)') };
  }

  return { ok: true, value: users };
}

function parseFollowingJson(raw) {
  if (!isRecord(raw)) {
    return { ok: false, error: new Error('following.json: expected top-level object') };
  }

  const relationships = raw['relationships_following'];
  if (!Array.isArray(relationships)) {
    return { ok: false, error: new Error('following.json: missing relationships_following array') };
  }

  const users = [];
  for (const rel of relationships) {
    if (!isRecord(rel)) continue;
    const title = typeof rel['title'] === 'string' ? rel['title'] : undefined;
    const entry = getFirstStringListEntry(rel);

    const username = title ?? entry?.value;
    if (!username) continue;

    users.push({
      username: normalizeUsername(username),
      href: entry?.href,
      timestamp: entry?.timestamp,
    });
  }

  if (users.length === 0) {
    return { ok: false, error: new Error('following.json: no users found (unexpected shape)') };
  }

  return { ok: true, value: users };
}

function parseUnfollowedUsersJson(raw) {
  if (!isRecord(raw)) {
    return { ok: false, error: new Error('unfollowed users: expected top-level object') };
  }

  const relationships = raw['relationships_unfollowed_users'];
  if (!Array.isArray(relationships)) {
    return { ok: true, value: [] };
  }

  const users = [];
  for (const rel of relationships) {
    const entry = getFirstStringListEntry(rel);
    if (!entry?.value) continue;
    users.push({
      username: normalizeUsername(entry.value),
      href: entry.href,
      timestamp: entry.timestamp,
    });
  }

  return { ok: true, value: users };
}

function toUniqueByUsername(users) {
  const map = new Map();
  for (const user of users) {
    const key = normalizeUsername(user.username).toLowerCase();
    if (!key) continue;
    if (!map.has(key)) map.set(key, user);
  }

  return [...map.values()].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
  );
}

function parseInstagramUsersFromConnectionHtml(html) {
  // HTML lists contain many links like:
  // - https://www.instagram.com/<username>
  // - https://www.instagram.com/_u/<username> (found in following.html exports)
  // Capture only valid handle characters to avoid trailing markup artifacts like `<`.
  const hrefPattern = /https?:\/\/(?:www\.)?instagram\.com\/(?:_u\/)?([A-Za-z0-9._]+)/g;
  const usernames = new Set();

  let match;
  while ((match = hrefPattern.exec(html))) {
    const username = match[1];
    if (!username) continue;
    const normalized = normalizeUsername(username);
    if (!normalized) continue;
    usernames.add(normalized);
  }

  const users = [];
  for (const username of usernames) {
    users.push({ username, href: `https://www.instagram.com/${encodeURIComponent(username)}/` });
  }

  return users.sort((a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }));
}

function parseFollowersHtml(raw) {
  if (typeof raw !== 'string') return { ok: false, error: new Error('followers_1.html: expected HTML string') };
  const users = parseInstagramUsersFromConnectionHtml(raw);
  if (users.length === 0) return { ok: false, error: new Error('followers_1.html: no users found (unexpected html)') };
  return { ok: true, value: users };
}

function parseFollowingHtml(raw) {
  if (typeof raw !== 'string') return { ok: false, error: new Error('following.html: expected HTML string') };
  const users = parseInstagramUsersFromConnectionHtml(raw);
  if (users.length === 0) return { ok: false, error: new Error('following.html: no users found (unexpected html)') };
  return { ok: true, value: users };
}

function parseUnfollowedUsersHtml(raw) {
  if (typeof raw !== 'string') return { ok: false, error: new Error('recently_unfollowed_profiles.html: expected HTML string') };
  const users = parseInstagramUsersFromConnectionHtml(raw);
  return { ok: true, value: users };
}

function findZipFile(zip, expectedPathSuffix) {
  const normalizedSuffix = expectedPathSuffix.replace(/\\/g, '/');
  const candidates = Object.keys(zip.files).filter((p) => p.replace(/\\/g, '/').endsWith(normalizedSuffix));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Prefer the canonical Instagram export location if multiple matches exist.
  const preferred = candidates.find((p) => p.replace(/\\/g, '/').includes('/connections/followers_and_following/'));
  return preferred ?? candidates[0];
}

function findZipFileAnySuffix(zip, expectedPathSuffixes) {
  for (const suffix of expectedPathSuffixes) {
    const match = findZipFile(zip, suffix);
    if (match) return match;
  }
  return null;
}

async function readZipText(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in zip: ${path}`);
  return file.async('text');
}

async function readZipJson(zip, path) {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing file in zip: ${path}`);
  const text = await file.async('text');
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new Error(`Invalid JSON in ${path}`, { cause });
  }
}

export async function parseInstagramExportZip(file) {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Please upload the Instagram export .zip file.');
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (cause) {
    throw new Error('Could not read ZIP. Is the file a valid .zip?', { cause });
  }

  // Instagram export structure can vary. Prefer the canonical path but fall back
  // to alternative suffixes when `connections/` isn't present.
  const followersPath = findZipFileAnySuffix(zip, [
    'connections/followers_and_following/followers_1.json',
    'connections/followers_and_following/followers_1.html',
    'followers_and_following/followers_1.json',
    'followers_and_following/followers_1.html',
    'followers_1.json',
    'followers_1.html',
  ]);
  const followingPath = findZipFileAnySuffix(zip, [
    'connections/followers_and_following/following.json',
    'connections/followers_and_following/following.html',
    'followers_and_following/following.json',
    'followers_and_following/following.html',
    'following.json',
    'following.html',
  ]);
  const unfollowedPath = findZipFileAnySuffix(zip, [
    'connections/followers_and_following/recently_unfollowed_profiles.json',
    'connections/followers_and_following/recently_unfollowed_profiles.html',
    'followers_and_following/recently_unfollowed_profiles.json',
    'followers_and_following/recently_unfollowed_profiles.html',
    'recently_unfollowed_profiles.json',
    'recently_unfollowed_profiles.html',
  ]);

  if (!followersPath || !followingPath) {
    const available = Object.keys(zip.files)
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => p.endsWith('.json') || p.endsWith('.html'))
      .slice(0, 30);
    throw new Error(
      `Could not find required files for followers diff. ` +
        `Expected followers_1.(json|html) and following.(json|html) (in connections/followers_and_following/ or equivalent). ` +
        (available.length
          ? `Found JSON/HTML files (first 30): ${available.join(', ')}`
          : 'No JSON/HTML files found.'),
    );
  }

  const followersRaw = followersPath.endsWith('.html') ? await readZipText(zip, followersPath) : await readZipJson(zip, followersPath);
  const followingRaw = followingPath.endsWith('.html') ? await readZipText(zip, followingPath) : await readZipJson(zip, followingPath);
  const unfollowedRaw = unfollowedPath
    ? unfollowedPath.endsWith('.html')
      ? await readZipText(zip, unfollowedPath)
      : await readZipJson(zip, unfollowedPath)
    : null;

  const followersParsed = followersPath.endsWith('.html') ? parseFollowersHtml(followersRaw) : parseFollowersJson(followersRaw);
  if (!followersParsed.ok) throw followersParsed.error;

  const followingParsed = followingPath.endsWith('.html') ? parseFollowingHtml(followingRaw) : parseFollowingJson(followingRaw);
  if (!followingParsed.ok) throw followingParsed.error;

  const unfollowedParsed = unfollowedPath
    ? unfollowedPath.endsWith('.html')
      ? parseUnfollowedUsersHtml(unfollowedRaw)
      : parseUnfollowedUsersJson(unfollowedRaw)
    : followingPath.endsWith('.html')
      ? parseUnfollowedUsersHtml(followingRaw)
      : parseUnfollowedUsersJson(followingRaw);
  if (!unfollowedParsed.ok) throw unfollowedParsed.error;

  return {
    followers: toUniqueByUsername(followersParsed.value),
    following: toUniqueByUsername(followingParsed.value),
    unfollowedUsers: toUniqueByUsername(unfollowedParsed.value),
  };
}

export function computeInstagramDiffs(data) {
  const followersByKey = new Map(data.followers.map((u) => [u.username.toLowerCase(), u]));
  const followingByKey = new Map(data.following.map((u) => [u.username.toLowerCase(), u]));

  const mutual = [];
  for (const [key, user] of followingByKey) {
    if (followersByKey.has(key)) mutual.push(user);
  }

  const notFollowingBack = [];
  for (const [key, user] of followingByKey) {
    if (!followersByKey.has(key)) notFollowingBack.push(user);
  }

  const fans = [];
  for (const [key, user] of followersByKey) {
    if (!followingByKey.has(key)) fans.push(user);
  }

  const sortByName = (a, b) => a.username.localeCompare(b.username, undefined, { sensitivity: 'base' });

  return {
    summary: {
      followersCount: data.followers.length,
      followingCount: data.following.length,
      mutualCount: mutual.sort(sortByName).length,
    },
    notFollowingBack: notFollowingBack.sort(sortByName),
    fans: fans.sort(sortByName),
    unfollowedUsers: data.unfollowedUsers.slice().sort(sortByName),
  };
}

