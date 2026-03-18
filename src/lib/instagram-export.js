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

function findZipFile(zip, expectedPathSuffix) {
  const normalizedSuffix = expectedPathSuffix.replace(/\\/g, '/');
  const candidates = Object.keys(zip.files).filter((p) => p.replace(/\\/g, '/').endsWith(normalizedSuffix));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Prefer the canonical Instagram export location if multiple matches exist.
  const preferred = candidates.find((p) => p.replace(/\\/g, '/').includes('/connections/followers_and_following/'));
  return preferred ?? candidates[0];
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

  const followersPath = findZipFile(zip, 'connections/followers_and_following/followers_1.json');
  const followingPath = findZipFile(zip, 'connections/followers_and_following/following.json');
  const unfollowedPath =
    findZipFile(zip, 'connections/followers_and_following/recently_unfollowed_profiles.json') ??
    findZipFile(zip, 'recently_unfollowed_profiles.json');

  if (!followersPath || !followingPath) {
    const available = Object.keys(zip.files)
      .map((p) => p.replace(/\\/g, '/'))
      .filter((p) => p.endsWith('.json'))
      .slice(0, 30);
    throw new Error(
      `Could not find required files under connections/followers_and_following/. ` +
        `Expected followers_1.json and following.json. ` +
        (available.length
          ? `Found JSON files (first 30): ${available.join(', ')}`
          : 'No JSON files found.'),
    );
  }

  const followersRaw = await readZipJson(zip, followersPath);
  const followingRaw = await readZipJson(zip, followingPath);
  const unfollowedRaw = unfollowedPath ? await readZipJson(zip, unfollowedPath) : null;

  const followersParsed = parseFollowersJson(followersRaw);
  if (!followersParsed.ok) throw followersParsed.error;

  const followingParsed = parseFollowingJson(followingRaw);
  if (!followingParsed.ok) throw followingParsed.error;

  const unfollowedParsed = parseUnfollowedUsersJson(unfollowedRaw ?? followingRaw);
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

