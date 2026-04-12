import sys
import json
import urllib.request
import urllib.error
import os
import re
import shutil
import time

PLUGIN_DIR = os.path.dirname(os.path.abspath(sys.argv[0]))
ASSETS_DIR = os.path.join(PLUGIN_DIR, "assets")
SESSION_COOKIE = None


# ── GraphQL ────────────────────────────────────────────────────────────────────

def graphql_query(url, apikey, query, variables=None):
    headers = {"Content-Type": "application/json"}
    if apikey:
        headers["ApiKey"] = apikey
    elif SESSION_COOKIE:
        headers["Cookie"] = SESSION_COOKIE
    data = json.dumps({"query": query, "variables": variables or {}}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"GraphQL request failed: {e}", flush=True)
        sys.exit(1)


def get_all_tags(url, apikey):
    """Return {tag_name_lower: {id, name}} for every tag in Stash."""
    res = graphql_query(url, apikey, """
    query { allTags { id name aliases } }
    """)
    tags = res.get("data", {}).get("allTags", [])
    lookup = {}
    for t in tags:
        lookup[t["name"].lower()] = {"id": t["id"], "name": t["name"]}
        for alias in (t.get("aliases") or []):
            if alias.lower() not in lookup:
                lookup[alias.lower()] = {"id": t["id"], "name": t["name"]}
    return lookup


def get_scenes_paginated(url, apikey, page=1, per_page=100):
    res = graphql_query(url, apikey, """
    query FindScenes($filter: FindFilterType) {
      findScenes(filter: $filter) {
        count
        scenes {
          id title
          tags { id name }
          files { id path size }
        }
      }
    }
    """, {"filter": {"page": page, "per_page": per_page, "sort": "id", "direction": "ASC"}})
    d = res.get("data", {}).get("findScenes", {})
    return d.get("count", 0), d.get("scenes", [])


def update_scene(url, apikey, scene_id, new_title, tag_ids):
    """Update scene title and tags via GraphQL."""
    res = graphql_query(url, apikey, """
    mutation SceneUpdate($input: SceneUpdateInput!) {
      sceneUpdate(input: $input) { id }
    }
    """, {"input": {"id": scene_id, "title": new_title, "tag_ids": tag_ids}})
    return res.get("data", {}).get("sceneUpdate")


def move_file(url, apikey, file_id, new_path):
    """Use Stash's moveFiles mutation to rename/move a file."""
    dest_folder   = os.path.dirname(new_path)
    dest_basename = os.path.basename(new_path)
    res = graphql_query(url, apikey, """
    mutation MoveFiles($input: MoveFilesInput!) {
      moveFiles(input: $input)
    }
    """, {"input": {"ids": [file_id], "destination_folder": dest_folder, "destination_basename": dest_basename}})
    return res.get("data", {}).get("moveFiles", False)


# ── Token extraction ───────────────────────────────────────────────────────────

# Sigil token patterns — a "sigil" is a leading _ or # that marks injected metadata.
#
# SIGIL_JOINED_RE: _Big_Ass or #Blow_Job  (Title_Case chain after sigil)
#   Matched first so _Big_Ass isn't split into _Big + _Ass by the word pass.
SIGIL_JOINED_RE = re.compile(
    r'(?<![A-Za-z0-9])'
    r'[_#]+'
    r'([A-Z][a-z]+(?:_[A-Z][a-z]+)+)'
    r'(?![A-Za-z0-9])'
)
# SIGIL_WORD_RE: _BigAss  #BlowJob  _HD  (single word, CamelCase allowed internally)
SIGIL_WORD_RE = re.compile(
    r'(?<![A-Za-z0-9])'
    r'[_#]+'
    r'([A-Za-z][A-Za-z0-9]*)'
    r'(?![A-Za-z0-9])'
)
# SIGIL_NUM_RE: _4K  #720p  _1080p  _60fps  (digit-starting shorthands)
#   Lookahead boundary used instead of lookbehind so "Word_4K_Next" is caught
#   even though the _ is also the separator after the preceding word.
SIGIL_NUM_RE = re.compile(r'[_#]+(\d+[A-Za-z]*)(?=[_\s#]|$)')


def token_to_phrase(raw_token):
    """Convert a raw token to a normalised phrase for tag lookup.

    '_Big_Ass'  → 'big ass'
    '#BlowJob'  → 'blow job'
    '_4K'       → '4k'        (digit tokens lowercased as-is)
    """
    s = re.sub(r'^[_#]+', '', raw_token)
    # Digit-starting shorthands: return lowercased directly
    if s and s[0].isdigit():
        return s.lower()
    parts = s.split('_')
    words = []
    for part in parts:
        words.extend(re.findall(r'[A-Z]?[a-z]+|[A-Z]+(?=[A-Z]|$)', part) or [part])
    return ' '.join(w.lower() for w in words if w)


def extract_candidate_tokens(filename_no_ext):
    """Return (sigil_tokens, other_tokens).

    sigil_tokens — every _/# prefixed token (joined, word, numeric).
                   Caller partitions into tag-matched vs unmatched junk.
    other_tokens — bare CamelCase / Title_Case tokens with no sigil.
                   Only used as tag candidates, never treated as junk.

    Both are lists of {"raw": str, "phrase": str}.
    """
    sigil_tokens = []
    other_tokens = []
    seen_raw     = set()
    seen_phrases = set()

    def _add_sigil(raw):
        if raw in seen_raw:
            return
        seen_raw.add(raw)
        phrase = token_to_phrase(raw)
        if phrase:
            seen_phrases.add(phrase)
        sigil_tokens.append({"raw": raw, "phrase": phrase})

    # Pass 1A: Title_Case chains  (_Big_Ass, #Blow_Job …) — must run before 1B
    for m in SIGIL_JOINED_RE.finditer(filename_no_ext):
        _add_sigil(m.group(0))

    # Pass 1B: single CamelCase / simple words  (_BigAss, #HD …)
    for m in SIGIL_WORD_RE.finditer(filename_no_ext):
        _add_sigil(m.group(0))

    # Pass 1C: digit shorthands  (_4K, #720p, _60fps …)
    for m in SIGIL_NUM_RE.finditer(filename_no_ext):
        _add_sigil(m.group(0))

    # Pass 2: bare CamelCase words not already captured  (BlowJob, BigAss …)
    for m in re.finditer(r'[A-Z][a-z]+(?:[A-Z][a-z]+)+', filename_no_ext):
        raw = m.group(0)
        phrase = ' '.join(re.findall(r'[A-Z][a-z]+', raw)).lower()
        if phrase and raw not in seen_raw and phrase not in seen_phrases:
            seen_raw.add(raw)
            seen_phrases.add(phrase)
            other_tokens.append({"raw": raw, "phrase": phrase})

    # Pass 3: underscore-joined Title_Case words without a leading sigil
    for m in re.finditer(r'(?<![_#])\b([A-Z][a-z]+(?:_[A-Z][a-z]+)+)\b', filename_no_ext):
        raw = m.group(1)
        phrase = raw.replace('_', ' ').lower()
        if phrase and raw not in seen_raw and phrase not in seen_phrases:
            seen_raw.add(raw)
            seen_phrases.add(phrase)
            other_tokens.append({"raw": raw, "phrase": phrase})

    return sigil_tokens, other_tokens


def build_new_filename(original_stem, tokens_to_remove):
    """
    Remove matched token strings from the filename stem, then clean up
    leftover underscores / double spaces / leading-trailing junk.
    """
    result = original_stem
    # Sort longest-first so overlapping removals don't leave fragments
    sorted_tokens = sorted(tokens_to_remove, key=lambda t: len(t["raw"]), reverse=True)
    for tok in sorted_tokens:
        result = result.replace(tok["raw"], '')

    # Clean up: collapse multiple underscores, trim leading/trailing punctuation
    result = re.sub(r'_+', '_', result)
    result = re.sub(r'^[_\-\s]+|[_\-\s]+$', '', result)
    result = re.sub(r'\s+', ' ', result).strip()
    return result


# ── Scan task ─────────────────────────────────────────────────────────────────

def task_scan(url, apikey):
    """
    Scan all scenes for filenames containing tag-like tokens.
    Write results to assets/sanitize_report.json.
    """
    os.makedirs(ASSETS_DIR, exist_ok=True)
    _write_status({"status": "running", "message": "Loading config…", "progress": 0})

    # Read plugin settings
    config_res = graphql_query(url, apikey, "query { configuration { plugins } }")
    plugins_cfg = config_res.get("data", {}).get("configuration", {}).get("plugins", {})
    my_cfg = plugins_cfg.get("MRStashSanitize", {})
    strip_unmatched = str(my_cfg.get("strip_unmatched_sigils", "true")).lower() not in ("false", "0", "no", "off")
    print(f"strip_unmatched_sigils={strip_unmatched}", flush=True)

    print("Loading all tags…", flush=True)
    tag_lookup = get_all_tags(url, apikey)
    print(f"Loaded {len(tag_lookup)} tags/aliases", flush=True)

    _write_status({"status": "running", "message": "Scanning scenes…", "progress": 5})

    # Paginate through all scenes
    page = 1
    per_page = 100
    total_count, first_batch = get_scenes_paginated(url, apikey, page, per_page)
    all_scenes = list(first_batch)
    while len(all_scenes) < total_count:
        page += 1
        _, batch = get_scenes_paginated(url, apikey, page, per_page)
        if not batch:
            break
        all_scenes.extend(batch)

    print(f"Total scenes: {total_count}, fetched: {len(all_scenes)}", flush=True)

    pending = []
    for idx, scene in enumerate(all_scenes):
        if idx % 50 == 0:
            pct = 5 + int(idx / max(len(all_scenes), 1) * 90)
            _write_status({"status": "running",
                           "message": f"Scanning {idx+1}/{len(all_scenes)}…",
                           "progress": pct})

        files = scene.get("files", [])
        if not files:
            continue
        file = files[0]
        path = file.get("path", "")
        if not path:
            continue

        dirname = os.path.dirname(path)
        basename_orig = os.path.basename(path)
        stem, ext = os.path.splitext(basename_orig)

        sigil_tokens, other_tokens = extract_candidate_tokens(stem)
        all_candidates = sigil_tokens + other_tokens

        if not all_candidates:
            continue

        # Partition candidates into tag-matched vs unmatched sigil junk
        matched = []           # has a Stash tag
        unmatched_sigil = []   # sigil-bearing but no tag match → strip if setting on

        for c in sigil_tokens:
            phrase = c["phrase"]
            if phrase in tag_lookup:
                matched.append({
                    "raw": c["raw"],
                    "phrase": phrase,
                    "tag_id": tag_lookup[phrase]["id"],
                    "tag_name": tag_lookup[phrase]["name"],
                })
            else:
                unmatched_sigil.append({"raw": c["raw"], "phrase": phrase})

        for c in other_tokens:
            phrase = c["phrase"]
            if phrase in tag_lookup:
                matched.append({
                    "raw": c["raw"],
                    "phrase": phrase,
                    "tag_id": tag_lookup[phrase]["id"],
                    "tag_name": tag_lookup[phrase]["name"],
                })
            # non-sigil tokens that don't match a tag are left alone — they're
            # likely real words in the title, not injected metadata

        # Decide what to strip from the filename
        tokens_to_strip = list(matched)
        if strip_unmatched:
            tokens_to_strip.extend(unmatched_sigil)

        # Skip scene if nothing would change
        if not tokens_to_strip and not matched:
            continue

        new_stem = build_new_filename(stem, tokens_to_strip)
        new_basename = new_stem + ext
        new_path = os.path.join(dirname, new_basename)

        existing_tag_ids = {t["id"] for t in scene.get("tags", [])}
        tags_to_add = [m for m in matched if m["tag_id"] not in existing_tag_ids]
        tags_already = [m for m in matched if m["tag_id"] in existing_tag_ids]

        # All tag IDs the scene should end up with
        all_tag_ids = list(existing_tag_ids | {m["tag_id"] for m in matched})

        # Only include scenes where something actually changes
        has_tag_changes    = len(tags_to_add) > 0
        has_file_changes   = new_basename != basename_orig
        if not has_tag_changes and not has_file_changes:
            continue

        pending.append({
            "scene_id": scene["id"],
            "scene_title": scene.get("title") or basename_orig,
            "file_id": file["id"],
            "original_path": path,
            "new_path": new_path,
            "original_stem": stem,
            "new_stem": new_stem,
            "matched_tokens": matched,
            "unmatched_tokens": unmatched_sigil,   # junk tokens with no tag
            "stripped_unmatched": strip_unmatched,  # record what setting was active
            "tags_to_add": tags_to_add,
            "tags_already_on_scene": tags_already,
            "all_tag_ids": all_tag_ids,
            "filename_changes": has_file_changes,
        })

    report = {
        "status": "done",
        "message": f"Found {len(pending)} scenes needing sanitization.",
        "progress": 100,
        "total_scanned": len(all_scenes),
        "pending": pending,
        "generated_at": int(time.time()),
    }
    _write_report(report)
    _write_status({"status": "done",
                   "message": f"Scan complete. {len(pending)} scenes found.",
                   "progress": 100})
    print(f"Scan complete. {len(pending)} scenes to sanitize.", flush=True)


# ── Apply task ────────────────────────────────────────────────────────────────

def task_apply(url, apikey, args):
    """
    Apply a subset of the pending changes. Accepts a JSON list of scene_ids to apply.
    args["scene_ids"] = comma-separated IDs  OR  "all"
    """
    scene_ids_arg = str(args.get("scene_ids", "all")).strip()

    report_path = os.path.join(ASSETS_DIR, "sanitize_report.json")
    if not os.path.exists(report_path):
        print("No report found. Run Scan first.", flush=True)
        sys.exit(1)

    with open(report_path) as f:
        report = json.load(f)

    pending = report.get("pending", [])
    if not pending:
        print("Nothing to apply.", flush=True)
        return

    if scene_ids_arg == "all":
        to_apply = pending
    else:
        ids_set = set(scene_ids_arg.split(","))
        to_apply = [p for p in pending if str(p["scene_id"]) in ids_set]

    print(f"Applying {len(to_apply)} changes…", flush=True)
    done, errors = 0, 0

    for item in to_apply:
        sid = item["scene_id"]
        try:
            # 1. Rename file via Stash moveFiles
            if item.get("filename_changes") and item["original_path"] != item["new_path"]:
                ok = move_file(url, apikey, item["file_id"], item["new_path"])
                if not ok:
                    print(f"  WARNING: moveFiles returned false for scene {sid}", flush=True)

            # 2. Update scene title (strip matched tokens AND unmatched junk from title)
            original_title = item.get("scene_title", "")
            new_title = original_title
            all_tokens_to_strip_from_title = list(item.get("matched_tokens", []))
            if item.get("stripped_unmatched"):
                all_tokens_to_strip_from_title.extend(item.get("unmatched_tokens", []))
            for tok in all_tokens_to_strip_from_title:
                new_title = re.sub(re.escape(tok["raw"]), '', new_title, flags=re.IGNORECASE)
            new_title = re.sub(r'\s+', ' ', new_title).strip()
            if not new_title:
                new_title = item["new_stem"]

            # 3. Update tags
            all_tag_ids = item.get("all_tag_ids", [])
            update_scene(url, apikey, sid, new_title, all_tag_ids)

            done += 1
            print(f"  ✓ Scene {sid}: {os.path.basename(item['original_path'])} → {os.path.basename(item['new_path'])}", flush=True)
        except Exception as e:
            errors += 1
            print(f"  ✗ Scene {sid}: {e}", flush=True)

    # Update report — remove applied items from pending
    applied_ids = {item["scene_id"] for item in to_apply}
    report["pending"] = [p for p in pending if p["scene_id"] not in applied_ids]
    report["last_apply"] = {
        "done": done,
        "errors": errors,
        "timestamp": int(time.time()),
    }
    _write_report(report)
    print(f"Apply complete: {done} done, {errors} errors.", flush=True)


def _write_status(data):
    os.makedirs(ASSETS_DIR, exist_ok=True)
    with open(os.path.join(ASSETS_DIR, "sanitize_status.json"), "w") as f:
        json.dump(data, f)


def _write_report(data):
    os.makedirs(ASSETS_DIR, exist_ok=True)
    with open(os.path.join(ASSETS_DIR, "sanitize_report.json"), "w") as f:
        json.dump(data, f)


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    raw_stdin = sys.stdin.read()
    if not raw_stdin.strip():
        print("ERROR: stdin is empty.", flush=True)
        sys.exit(1)

    input_data = json.loads(raw_stdin)
    server_connection = input_data.get("server_connection", {})
    scheme = server_connection.get("Scheme", "http")
    port = server_connection.get("Port", 9999)
    apikey = server_connection.get("ApiKey", "")

    if not apikey:
        cookie_obj = server_connection.get("SessionCookie", {})
        cookie_name = cookie_obj.get("Name", "session")
        cookie_value = cookie_obj.get("Value", "")
        if cookie_value:
            global SESSION_COOKIE
            SESSION_COOKIE = f"{cookie_name}={cookie_value}"

    plugin_dir_from_stash = server_connection.get("PluginDir", "")
    if plugin_dir_from_stash:
        global PLUGIN_DIR, ASSETS_DIR
        PLUGIN_DIR = plugin_dir_from_stash
        ASSETS_DIR = os.path.join(PLUGIN_DIR, "assets")
        os.makedirs(ASSETS_DIR, exist_ok=True)

    url = f"{scheme}://localhost:{port}/graphql"

    raw_args = input_data.get("args", {})
    task_name = raw_args.get("mode", "") if isinstance(raw_args, dict) else ""
    if not task_name:
        task_name = input_data.get("task", {}).get("name", "")

    plugin_args = raw_args if isinstance(raw_args, dict) else {}
    print(f"Task={task_name!r} PluginDir={PLUGIN_DIR!r}", flush=True)

    if task_name == "Scan for Dirty Filenames":
        task_scan(url, apikey)
    elif task_name == "Apply Sanitization":
        task_apply(url, apikey, plugin_args)
    else:
        print(f"Unknown task: {task_name!r}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()