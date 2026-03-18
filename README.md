# Instacheck (Instagram Export Diff Visualizer)

Instacheck is a local-first web app that helps you analyze your Instagram follower relationships using your Instagram **“Connections” export ZIP**. Upload the ZIP that you downloaded from Instagram, and Instacheck will parse the expected JSON files inside (for example `connections/followers_and_following/followers_1.json` and `connections/followers_and_following/following.json`), compute relationship diffs, and render lists such as:

* People you follow who don’t follow you back (`not-following-back`)
* People who follow you but you don’t follow back (`fans`)
* Mutuals (intersection of followers and following)
* Recently unfollowed users (when present in your export)

Processing happens in your browser. No user accounts are created, and your Instagram export data is not sent to a server by this app.

If you are searching for keywords like *Instagram export zip diff*, *followers_and_following followers_1.json vs following.json*, *not following back list*, or *fans / unfollowed users visualization*, you are in the right place.

---

## Key Features

* Local parsing of an Instagram export ZIP using `jszip`
* Strictly expects Instagram export files from the `connections/followers_and_following/` area
* Computes diffs:
  * `mutuals` = intersection of `followers` and `following`
  * `notFollowingBack` = `following - followers`
  * `fans` = `followers - following`
* Attempts to read `recently_unfollowed_profiles.json` (or the nested `connections/` variant)
* Tracks per-user “processing status” (open / in progress / on hold / attention requred / done)
* Exports/imports the status map so you can carry your review progress between machines

---

## AI Search / Retrieval Keywords

This README intentionally includes common terms that are useful for AI search and document retrieval:

* `Instacheck`
* `Instagram export ZIP`
* `connections/followers_and_following`
* `followers_1.json`
* `following.json`
* `recently_unfollowed_profiles.json`
* `string_list_data`
* `relationships_following`
* `relationships_unfollowed_users`
* `not following back`
* `fans`
* `mutuals`
* `local-first`
* `no server processing`
* `localStorage status export`
* `username normalization (trim, remove @, case-insensitive compare)`
* `diff computation (set intersection / set difference)`

---

## How It Works (Local-First)

1. You upload the Instagram export ZIP.
2. Instacheck unpacks the ZIP in your browser and searches for the required JSON files by suffix.
3. It parses:
   * `followers_1.json` as a list of usernames
   * `following.json` as a set of usernames
   * optionally `recently_unfollowed_profiles.json` (or `connections/followers_and_following/recently_unfollowed_profiles.json`)
4. It normalizes usernames and computes diffs.
5. It renders the results and allows you to mark each user with a status.

---

## What You Need

### 1. Your Instagram Export ZIP

Instacheck expects your ZIP to contain the following JSON files somewhere inside (path matching is done by suffix):

* `connections/followers_and_following/followers_1.json`
* `connections/followers_and_following/following.json`
* Optionally:
  * `connections/followers_and_following/recently_unfollowed_profiles.json`
  * or `recently_unfollowed_profiles.json`

If those files are not found, Instacheck will show an error listing the JSON files it found (first 30).

### 2. Browser Support

Instacheck runs in modern browsers that support ES modules and `localStorage`. ZIP parsing is performed client-side.

---

## Relationship Definitions (Exact)

Instacheck uses case-insensitive username matching. Usernames are normalized by:

* trimming whitespace
* removing a leading `@` (if present)

Then diffs are computed as sets:

* `mutualCount` = followers intersect following
* `notFollowingBack` = following entries not present in followers
* `fans` = followers entries not present in following
* `unfollowedUsers` = parsed from the unfollowed users JSON (or fallback)

Lists are sorted alphabetically by username in a case-insensitive manner.

---

## Expected Instagram JSON Shapes

Instacheck is built around the shapes Instagram uses in the “connections” export.

### `followers_1.json`

* Expected top-level value: an array
* Each array item is expected to contain `string_list_data` with at least one entry
* Username is read from the first `string_list_data` item’s `value`
* Optional fields:
  * `href` (if present)
  * `timestamp` (if present)

### `following.json`

* Expected top-level value: an object
* Expected field: `relationships_following` (array)
* Each relationship item may contain:
  * `title` (preferred username)
  * otherwise `string_list_data[0].value`
* Optional fields:
  * `href`
  * `timestamp`

### `recently_unfollowed_profiles.json`

* Expected top-level value: an object
* Expected field: `relationships_unfollowed_users` (array)
* It extracts usernames from the first string list entry’s `value`

Note: `unfollowedUsers` parsing is designed to be tolerant of missing unfollowed structures (so the UI can still show an “unfollowed” list).

---

## UI Output: What You See

After upload, Instacheck displays:

* Basic summary counts:
  * Followers
  * Following
  * Mutuals
* Lists:
  * People you follow who don’t follow you back
  * People who follow you but you don’t follow back
  * Accounts you unfollowed (from export)

Each listed username includes a per-user status selector.

---

## Per-User Review Status (open / done)

Instacheck stores review status in `localStorage` under the prefix:

* `instacheck:`

### Status Enum

The current UI supports these status values:

* `open`
* `in progress`
* `on hold`
* `attention requred`
* `done`

Important: the status value `attention requred` is spelled exactly as in the app code/export (including the typo).

### Exporting Your Status Map

Use the Export button in the UI. It downloads a JSON file named like:

* `instacheck-status-map-YYYY-MM-DD.json`

The export includes:

* `version`
* `prefix` (`instacheck:`)
* `exportedAt` (ISO timestamp)
* `entries` (key-value map of storage keys to status strings)

### Importing a Status Map

Use Import file or Select JSON file to import a previously exported status map.

Import payload compatibility:

* Standard shape: an object with an `entries` object
* Tolerant alternative shape: an object with a `data` object
* Advanced shape: a raw object whose keys start with `instacheck:`

Import validation:

* each value must be a supported status string
* each key must parse as `instacheck:<kind>:<username>`

Kind values used by this app are:

* `not-following-back`
* `fans`
* `unfollowed`

When you set a user back to `open`, Instacheck removes that storage entry (so it does not persist as `open`).

---

## Quickstart (Development)

### Requirements

* Node.js >= `22.12.0`

### Install

```sh
npm install
```

### Run locally

```sh
npm run dev
```

Astro will start a dev server (typically on `localhost:4321`).

### Build

```sh
npm run build
```

---

## Development Notes (Modules)

For contributors and advanced users:

* `src/scripts/app.js`
  * Implements UI behavior:
    * ZIP file upload handler
    * list rendering
    * status selector actions
    * status export/import
* `src/lib/instagram-export.ts`
  * Implements:
    * `parseInstagramExportZip(file)`
    * `computeInstagramDiffs(data)`
  * Uses:
    * `jszip` to read ZIP contents in the browser
    * username normalization and set-based diff logic

---

## Troubleshooting

### Error: “Could not find required files…”

This usually means your ZIP does not include Instagram “Connections” data, or the export structure is different.

Things to try:

* Re-download your Instagram export and ensure it includes followers/following connections
* Verify it contains `followers_1.json` and `following.json`
* Try a different export time period (Instagram export content can vary)

### Error: “Invalid JSON …”

If Instacheck cannot parse a JSON file inside the ZIP:

* Confirm the ZIP was not corrupted when downloading
* Confirm it is actually an Instagram export ZIP

### Large exports / slow parsing

ZIP parsing is done client-side, so large exports can take time depending on CPU and browser memory.

If your browser becomes unresponsive:

* Try again with a more recent/smaller export
* Use a modern browser with sufficient RAM

---

## Privacy, Security, and Data Handling

* Instacheck is designed to process the Instagram export ZIP locally in your browser.
* The only persistent storage used for review progress is your browser `localStorage` under `instacheck:`.
* Export/import of status maps creates a JSON file you can share yourself; Instacheck does not automatically upload these files anywhere.

If you deploy Instacheck somewhere publicly, make sure your hosting environment does not add server-side logging that could capture user-upload metadata.

---

## Limitations

* Instacheck relies on Instagram’s export JSON format. If Instagram changes the export schema, parsing may fail or lists may be incomplete.
* The app focuses on relationship diffs; it does not attempt to classify “why” someone is unfollowing (no activity history).
* Status export/import only covers review status, not the parsed follower graph.

---

## License

No license file is present in this repository. If you plan to publish or distribute Instacheck, consider adding a license and ensuring compliance with the licenses of included dependencies.
