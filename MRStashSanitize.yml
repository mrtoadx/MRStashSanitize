(function () {
  "use strict";

  const PluginApi = window.PluginApi;
  const React = window.React || PluginApi.React;
  const ReactDOM = window.ReactDOM || PluginApi.ReactDOM;
  const { useState, useEffect, useRef, useCallback } = React;
  const ce = React.createElement;

  const LOG  = (...a) => console.log("[MRStashSanitize]",  ...a);
  const WARN = (...a) => console.warn("[MRStashSanitize]", ...a);

  LOG("Plugin loaded");

  // ── GraphQL ──────────────────────────────────────────────────────────────────

  async function gqlQuery(query, variables) {
    const res = await fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data;
  }

  async function runPluginTask(taskName, args) {
    await gqlQuery(
      `mutation RunPluginTask($plugin_id: ID!, $task_name: String!, $args: [PluginArgInput!]) {
        runPluginTask(plugin_id: $plugin_id, task_name: $task_name, args: $args)
      }`,
      { plugin_id: "MRStashSanitize", task_name: taskName, args: args || [] }
    );
  }

  // ── Asset polling ─────────────────────────────────────────────────────────────

  async function fetchAssetJSON(filename) {
    const res = await fetch(`/plugin/MRStashSanitize/assets/${filename}?t=${Date.now()}`);
    if (!res.ok) return null;
    return res.json();
  }

  function pollUntilDone(filename, onUpdate, onDone, onError, intervalMs, maxMs) {
    const start = Date.now();
    const limit = maxMs || 300_000;
    const iv = setInterval(async () => {
      if (Date.now() - start > limit) {
        clearInterval(iv);
        onError("Timed out waiting for task.");
        return;
      }
      try {
        const data = await fetchAssetJSON(filename);
        if (!data) return;
        onUpdate(data);
        if (data.status === "done" || data.status === "error") {
          clearInterval(iv);
          if (data.status === "done") onDone(data);
          else onError(data.message || "Task failed.");
        }
      } catch (_) {}
    }, intervalMs || 600);
    return () => clearInterval(iv);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function basename(p) { return p.split(/[\\/]/).pop(); }

  function diffHighlight(original, updated) {
    // Return segments: [{text, changed}]
    if (original === updated) return [{ text: original, changed: false }];
    // Simple character diff — highlight what was removed
    const segs = [];
    let i = 0, j = 0;
    // find common prefix
    while (i < original.length && j < updated.length && original[i] === updated[j]) { i++; j++; }
    if (i > 0) segs.push({ text: original.slice(0, i), changed: false });
    // find common suffix
    let si = original.length - 1, sj = updated.length - 1;
    while (si > i && sj > j && original[si] === updated[sj]) { si--; sj--; }
    const removedPart = original.slice(i, si + 1);
    const addedPart   = updated.slice(j, sj + 1);
    if (removedPart) segs.push({ text: removedPart, changed: "removed" });
    if (addedPart)   segs.push({ text: addedPart,   changed: "added" });
    const suffix = original.slice(si + 1);
    if (suffix) segs.push({ text: suffix, changed: false });
    return segs;
  }

  // ── Icons (inline SVG) ────────────────────────────────────────────────────────

  const IconScan    = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:16,height:16,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("circle",{cx:11,cy:11,r:8}),ce("line",{x1:21,y1:21,x2:16.65,y2:16.65}));
  const IconCheck   = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},ce("polyline",{points:"20 6 9 17 4 12"}));
  const IconX       = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},ce("line",{x1:18,y1:6,x2:6,y2:18}),ce("line",{x1:6,y1:6,x2:18,y2:18}));
  const IconTag     = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:12,height:12,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("path",{d:"M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"}),ce("line",{x1:7,y1:7,x2:"7.01",y2:7}));
  const IconArrow   = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("line",{x1:5,y1:12,x2:19,y2:12}),ce("polyline",{points:"12 5 19 12 12 19"}));

  // ── Junk chip (unmatched sigil token) ────────────────────────────────────────

  function JunkChip({ raw }) {
    return ce("span", {
      className: "ss-tag-chip ss-tag-junk",
      title: "Sigil token with no matching tag — will be stripped from filename",
    },
      ce("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: 11, height: 11,
        fill: "none", stroke: "currentColor", strokeWidth: 2.5,
        strokeLinecap: "round", strokeLinejoin: "round" },
        ce("polyline", { points: "3 6 5 6 21 6" }),
        ce("path", { d: "M19 6l-1 14H6L5 6" }),
        ce("path", { d: "M10 11v6M14 11v6" }),
        ce("path", { d: "M9 6V4h6v2" })
      ),
      " ", raw
    );
  }

  // ── Tag chip ──────────────────────────────────────────────────────────────────

  function TagChip({ name, isNew }) {
    return ce("span", {
      className: `ss-tag-chip ${isNew ? "ss-tag-new" : "ss-tag-existing"}`,
      title: isNew ? "Will be added" : "Already on scene",
    },
      ce(IconTag),
      " ", name
    );
  }

  // ── FilenameChange ────────────────────────────────────────────────────────────

  function FilenameChange({ item }) {
    const origBase = basename(item.original_path);
    const newBase  = basename(item.new_path);

    return ce("div", { className: "ss-filename-change" },
      ce("div", { className: "ss-filename-row" },
        ce("span", { className: "ss-fname-label" }, "FROM"),
        ce("code", { className: "ss-fname ss-fname-old" }, origBase)
      ),
      ce("div", { className: "ss-filename-row" },
        ce("span", { className: "ss-fname-label" }, "TO"),
        ce("code", { className: "ss-fname ss-fname-new" }, newBase)
      )
    );
  }

  // ── Row ───────────────────────────────────────────────────────────────────────

  function SceneRow({ item, selected, onToggle }) {
    const newTags      = item.tags_to_add || [];
    const existingTags = item.tags_already_on_scene || [];
    const junkTokens   = item.unmatched_tokens || [];
    const strippedJunk = item.stripped_unmatched;

    return ce("div", { className: `ss-row ${selected ? "ss-row-selected" : ""}` },
      // Checkbox
      ce("div", { className: "ss-row-check", onClick: onToggle },
        ce("div", { className: `ss-checkbox ${selected ? "ss-checkbox-on" : ""}` },
          selected ? ce(IconCheck) : null
        )
      ),
      // Body
      ce("div", { className: "ss-row-body" },
        ce("div", { className: "ss-scene-title" },
          ce("span", { className: "ss-scene-id" }, `#${item.scene_id}`),
          " ",
          item.scene_title
        ),
        item.filename_changes
          ? ce(FilenameChange, { item })
          : ce("div", { className: "ss-no-rename" }, "Filename unchanged — tags only"),
        // Tags + junk chips
        (newTags.length > 0 || existingTags.length > 0 || junkTokens.length > 0) && ce("div", { className: "ss-tags-row" },
          newTags.map(t      => ce(TagChip, { key: t.tag_id, name: t.tag_name, isNew: true })),
          existingTags.map(t => ce(TagChip, { key: t.tag_id, name: t.tag_name, isNew: false })),
          strippedJunk && junkTokens.map(t => ce(JunkChip, { key: t.raw, raw: t.raw }))
        )
      ),
      // Accept / Reject quick buttons
      ce("div", { className: "ss-row-actions" },
        ce("button", {
          className: `ss-icon-btn ${selected ? "ss-icon-btn-active" : ""}`,
          onClick: onToggle,
          title: selected ? "Deselect" : "Select",
        }, selected ? ce(IconX) : ce(IconCheck))
      )
    );
  }

  // ── Main Modal ────────────────────────────────────────────────────────────────

  function SanitizeModal({ onClose }) {
    const [phase, setPhase]           = useState("idle");   // idle | scanning | review | applying | done | error
    const [scanStatus, setScanStatus] = useState(null);
    const [report, setReport]         = useState(null);
    const [selected, setSelected]     = useState(new Set());
    const [applyMsg, setApplyMsg]     = useState("");
    const [errorMsg, setErrorMsg]     = useState("");
    const [filter, setFilter]         = useState("all");    // all | filename | tagsonly
    const [search, setSearch]         = useState("");
    const cancelRef = useRef(null);

    useEffect(() => {
      document.body.style.overflow = "hidden";
      // Try to load an existing report on open
      fetchAssetJSON("sanitize_report.json").then(data => {
        if (data && data.status === "done" && data.pending && data.pending.length > 0) {
          setReport(data);
          setSelected(new Set(data.pending.map(p => p.scene_id)));
          setPhase("review");
        }
      }).catch(() => {});
      return () => { document.body.style.overflow = ""; };
    }, []);

    async function handleScan() {
      if (cancelRef.current) cancelRef.current();
      setPhase("scanning");
      setScanStatus({ status: "running", message: "Starting scan…", progress: 0 });
      setReport(null);
      setSelected(new Set());
      setErrorMsg("");

      try {
        await runPluginTask("Scan for Dirty Filenames", []);
      } catch (e) {
        setPhase("error");
        setErrorMsg("Failed to start scan: " + e.message);
        return;
      }

      cancelRef.current = pollUntilDone(
        "sanitize_status.json",
        (data) => setScanStatus(data),
        async (_data) => {
          // Load the full report
          const r = await fetchAssetJSON("sanitize_report.json");
          if (r) {
            setReport(r);
            setSelected(new Set(r.pending.map(p => p.scene_id)));
          }
          setPhase("review");
        },
        (err) => { setPhase("error"); setErrorMsg(err); },
        600, 300_000
      );
    }

    async function handleApply() {
      if (!report || selected.size === 0) return;
      setPhase("applying");
      setApplyMsg("Queuing apply task…");
      setErrorMsg("");

      const ids = [...selected].join(",");
      try {
        await runPluginTask("Apply Sanitization", [
          { key: "scene_ids", value: { str: ids } },
        ]);
      } catch (e) {
        setPhase("error");
        setErrorMsg("Failed to queue apply: " + e.message);
        return;
      }

      // Poll the report for the last_apply key as confirmation
      let attempts = 0;
      const iv = setInterval(async () => {
        attempts++;
        const r = await fetchAssetJSON("sanitize_report.json").catch(() => null);
        if (r && r.last_apply) {
          clearInterval(iv);
          setReport(r);
          setSelected(new Set(r.pending.map(p => p.scene_id)));
          const { done, errors } = r.last_apply;
          setApplyMsg(`Applied ${done} change${done !== 1 ? "s" : ""}${errors ? `, ${errors} errors` : ""}. Run a library scan to update Stash.`);
          setPhase("done");
        }
        if (attempts > 600) { clearInterval(iv); setPhase("error"); setErrorMsg("Timed out."); }
      }, 500);
      cancelRef.current = () => clearInterval(iv);
    }

    function toggleAll(val) {
      if (!report) return;
      setSelected(val ? new Set(filtered.map(p => p.scene_id)) : new Set());
    }

    function toggleOne(id) {
      setSelected(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
    }

    const pending  = (report && report.pending) || [];
    const filtered = pending.filter(p => {
      if (filter === "filename" && !p.filename_changes) return false;
      if (filter === "tagsonly" &&  p.filename_changes) return false;
      if (search) {
        const q = search.toLowerCase();
        const haystack = (p.scene_title + p.original_path).toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.scene_id));

    return ce("div", { className: "ss-overlay", onClick: e => { if (e.target === e.currentTarget) onClose(); } },
      ce("div", { className: "ss-modal" },

        // ── Header ──
        ce("div", { className: "ss-modal-header" },
          ce("div", { className: "ss-header-left" },
            ce("h2", null, "Filename Sanitizer"),
            ce("p", { className: "ss-subtitle" },
              "Detect tag-like tokens in filenames, strip them, and add matching Stash tags."
            )
          ),
          ce("button", { className: "ss-close-btn", onClick: onClose }, ce(IconX))
        ),

        // ── Scan bar ──
        ce("div", { className: "ss-scan-bar" },
          ce("button", {
            className: "ss-btn ss-btn-primary",
            onClick: handleScan,
            disabled: phase === "scanning" || phase === "applying",
          }, ce(IconScan), " ", phase === "scanning" ? "Scanning…" : "Scan Library"),

          scanStatus && phase === "scanning" && ce("div", { className: "ss-scan-progress" },
            ce("div", { className: "ss-progress-track" },
              ce("div", { className: "ss-progress-fill", style: { width: (scanStatus.progress || 2) + "%" } })
            ),
            ce("span", { className: "ss-scan-msg" }, scanStatus.message)
          ),

          report && phase !== "scanning" && ce("div", { className: "ss-scan-summary" },
            ce("span", { className: "ss-stat" },
              ce("strong", null, pending.length), " scenes to sanitize"
            ),
            report.total_scanned && ce("span", { className: "ss-stat-muted" },
              ` of ${report.total_scanned} scanned`
            )
          )
        ),

        // ── Error ──
        errorMsg && ce("div", { className: "ss-error-bar" }, errorMsg),

        // ── Done message ──
        phase === "done" && applyMsg && ce("div", { className: "ss-success-bar" }, applyMsg),

        // ── Review table ──
        (phase === "review" || phase === "applying" || phase === "done") && pending.length > 0 && ce("div", { className: "ss-review-section" },

          // Toolbar
          ce("div", { className: "ss-toolbar" },
            ce("label", { className: "ss-select-all" },
              ce("div", {
                className: `ss-checkbox ${allFilteredSelected ? "ss-checkbox-on" : ""}`,
                onClick: () => toggleAll(!allFilteredSelected),
              }, allFilteredSelected ? ce(IconCheck) : null),
              ce("span", null, `${selected.size} selected`)
            ),

            ce("div", { className: "ss-filter-group" },
              ["all", "filename", "tagsonly"].map(f =>
                ce("button", {
                  key: f,
                  className: `ss-filter-btn ${filter === f ? "ss-filter-active" : ""}`,
                  onClick: () => setFilter(f),
                }, f === "all" ? "All" : f === "filename" ? "Rename" : "Tags Only")
              )
            ),

            ce("input", {
              className: "ss-search",
              type: "text",
              placeholder: "Search…",
              value: search,
              onChange: e => setSearch(e.target.value),
            })
          ),

          // List
          ce("div", { className: "ss-list" },
            filtered.length === 0
              ? ce("div", { className: "ss-empty-list" }, "No scenes match the current filter.")
              : filtered.map(item =>
                  ce(SceneRow, {
                    key: item.scene_id,
                    item,
                    selected: selected.has(item.scene_id),
                    onToggle: () => toggleOne(item.scene_id),
                  })
                )
          )
        ),

        pending.length === 0 && (phase === "review" || phase === "done") && ce("div", { className: "ss-empty-state" },
          "✓ No scenes need sanitization."
        ),

        // ── Actions ──
        (phase === "review" || phase === "applying" || phase === "done") && pending.length > 0 && ce("div", { className: "ss-action-bar" },
          phase === "applying"
            ? ce("div", { className: "ss-applying-msg" },
                ce("div", { className: "ss-spinner" }),
                applyMsg || "Applying changes…"
              )
            : ce("button", {
                className: "ss-btn ss-btn-primary",
                onClick: handleApply,
                disabled: selected.size === 0 || phase !== "review",
              }, `Apply ${selected.size} Change${selected.size !== 1 ? "s" : ""}`)
          ,
          ce("button", {
            className: "ss-btn ss-btn-secondary",
            onClick: () => toggleAll(false),
            disabled: selected.size === 0,
          }, "Deselect All"),
          ce("button", {
            className: "ss-btn ss-btn-secondary",
            onClick: () => toggleAll(true),
            disabled: filtered.every(p => selected.has(p.scene_id)),
          }, "Select All")
        )
      )
    );
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────────

  let _modalRoot = null;

  function openModal() {
    if (!_modalRoot) {
      _modalRoot = document.createElement("div");
      _modalRoot.id = "ss-modal-root";
      document.body.appendChild(_modalRoot);
    }
    ReactDOM.render(ce(SanitizeModal, { onClose: closeModal }), _modalRoot);
  }

  function closeModal() {
    if (_modalRoot) ReactDOM.unmountComponentAtNode(_modalRoot);
  }

  // ── Nav button injection ──────────────────────────────────────────────────────

  function injectNavButton() {
    if (document.getElementById("ss-nav-btn")) return;
    const navbar = document.querySelector(".navbar") || document.querySelector("nav");
    if (!navbar) return;
    const target =
      navbar.querySelector(".navbar-buttons") ||
      navbar.querySelector(".ml-auto.navbar-nav") ||
      navbar.querySelector(".navbar-nav:last-child") ||
      navbar;

    const btn = document.createElement("button");
    btn.id = "ss-nav-btn";
    btn.title = "Filename Sanitizer";
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
    </svg>`;
    btn.style.cssText = [
      "background:transparent","border:none","color:#aaa","cursor:pointer",
      "padding:6px","display:inline-flex","align-items:center",
      "justify-content:center","border-radius:4px","line-height:1",
    ].join(";");
    btn.addEventListener("click", openModal);
    btn.addEventListener("mouseenter", () => { btn.style.color = "#4fc3f7"; });
    btn.addEventListener("mouseleave", () => { btn.style.color = "#aaa"; });
    target.insertBefore(btn, target.firstChild);
    LOG("Nav button injected");
  }

  setTimeout(injectNavButton, 800);
  PluginApi.Event.addEventListener("stash:location", () => setTimeout(injectNavButton, 300));

})();