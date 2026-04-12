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

  /**
   * Create a new tag in Stash and return its id.
   */
  async function createTag(name) {
    const data = await gqlQuery(`
      mutation TagCreate($input: TagCreateInput!) {
        tagCreate(input: $input) { id name }
      }
    `, { input: { name } });
    return data.tagCreate;
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
  function dirname(p)  { const parts = p.split(/[\\/]/); parts.pop(); return parts.join("/"); }

  // ── Icons ─────────────────────────────────────────────────────────────────────

  const IconScan  = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:16,height:16,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("circle",{cx:11,cy:11,r:8}),ce("line",{x1:21,y1:21,x2:16.65,y2:16.65}));
  const IconCheck = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},ce("polyline",{points:"20 6 9 17 4 12"}));
  const IconX     = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},ce("line",{x1:18,y1:6,x2:6,y2:18}),ce("line",{x1:6,y1:6,x2:18,y2:18}));
  const IconTag   = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:12,height:12,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("path",{d:"M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"}),ce("line",{x1:7,y1:7,x2:"7.01",y2:7}));
  const IconPlay  = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:14,height:14,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("polygon",{points:"5 3 19 12 5 21 5 3"}));
  const IconEdit  = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:13,height:13,fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"},ce("path",{d:"M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"}),ce("path",{d:"M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"}));
  const IconPlus  = () => ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:11,height:11,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},ce("line",{x1:12,y1:5,x2:12,y2:19}),ce("line",{x1:5,y1:12,x2:19,y2:12}));
  const IconSpinner = () => ce("div", { className: "ss-spinner" });

  // ── Tag chip ──────────────────────────────────────────────────────────────────

  function TagChip({ name, isNew }) {
    return ce("span", {
      className: `ss-tag-chip ${isNew ? "ss-tag-new" : "ss-tag-existing"}`,
      title: isNew ? "Will be added" : "Already on scene",
    },
      ce(IconTag), " ", name
    );
  }

  // ── Junk chip — with "promote to tag" button ──────────────────────────────────

  function JunkChip({ raw, phrase, onPromote, promoting }) {
    return ce("span", {
      className: `ss-tag-chip ss-tag-junk ${promoting ? "ss-tag-junk-promoting" : ""}`,
      title: promoting
        ? "Creating tag…"
        : `Sigil token with no matching tag — click + to create "${phrase}" as a Stash tag`,
    },
      ce("svg",{xmlns:"http://www.w3.org/2000/svg",viewBox:"0 0 24 24",width:11,height:11,fill:"none",stroke:"currentColor",strokeWidth:2.5,strokeLinecap:"round",strokeLinejoin:"round"},
        ce("polyline",{points:"3 6 5 6 21 6"}),
        ce("path",{d:"M19 6l-1 14H6L5 6"}),
        ce("path",{d:"M10 11v6M14 11v6"}),
        ce("path",{d:"M9 6V4h6v2"})
      ),
      " ", raw,
      " ",
      ce("button", {
        className: "ss-junk-promote-btn",
        title: `Create "${phrase}" tag and add to scene`,
        disabled: promoting,
        onClick: e => { e.stopPropagation(); onPromote(raw, phrase); },
      },
        promoting
          ? ce("div", { className: "ss-spinner ss-spinner-xs" })
          : ce(IconPlus)
      )
    );
  }

  // ── Inline filename editor ────────────────────────────────────────────────────

  function FilenameEditor({ item, overrideStem, onChangeStem }) {
    const origBase = basename(item.original_path);
    const ext      = origBase.includes(".") ? origBase.slice(origBase.lastIndexOf(".")) : "";

    // If there's an override use it, otherwise the computed new_stem
    const displayStem = overrideStem !== undefined ? overrideStem : item.new_stem;

    return ce("div", { className: "ss-filename-change" },
      // FROM row (static)
      ce("div", { className: "ss-filename-row" },
        ce("span", { className: "ss-fname-label" }, "FROM"),
        ce("code", { className: "ss-fname ss-fname-old" }, origBase)
      ),
      // TO row (editable)
      ce("div", { className: "ss-filename-row" },
        ce("span", { className: "ss-fname-label" }, "TO"),
        ce("div", { className: "ss-fname-edit-wrap" },
          ce("input", {
            className: "ss-fname-input",
            type: "text",
            value: displayStem,
            onChange: e => onChangeStem(e.target.value),
            spellCheck: false,
          }),
          ce("code", { className: "ss-fname-ext" }, ext)
        )
      )
    );
  }

  // ── Single scene row ──────────────────────────────────────────────────────────

  function SceneRow({ item, selected, onToggle, onApplyOne, overrideStem, onChangeStem }) {
    const [applying, setApplying]       = useState(false);
    const [applyDone, setApplyDone]     = useState(false);
    const [applyErr, setApplyErr]       = useState("");
    // local junk tokens state so promoting updates this row in place
    const [junkTokens, setJunkTokens]   = useState(item.unmatched_tokens || []);
    const [promotedTags, setPromotedTags] = useState([]); // {tag_id, tag_name}
    const [promoting, setPromoting]     = useState(null); // raw token being promoted

    const newTags      = item.tags_to_add || [];
    const existingTags = item.tags_already_on_scene || [];
    const strippedJunk = item.stripped_unmatched;

    async function handlePromote(raw, phrase) {
      setPromoting(raw);
      try {
        const tag = await createTag(phrase);
        // Remove from junk list, add to promoted tags
        setJunkTokens(prev => prev.filter(t => t.raw !== raw));
        setPromotedTags(prev => [...prev, { tag_id: tag.id, tag_name: tag.name }]);
        // Tell parent to incorporate this tag into the item's all_tag_ids
        // We surface this upward so apply picks it up
        onApplyOne && onApplyOne(item.scene_id, "add_tag", { tag_id: tag.id, tag_name: tag.name });
      } catch (e) {
        WARN("Promote failed:", e);
      } finally {
        setPromoting(null);
      }
    }

    async function handleApplyThis() {
      setApplying(true);
      setApplyErr("");
      try {
        await onApplyOne(item.scene_id, "apply", { overrideStem });
        setApplyDone(true);
      } catch (e) {
        setApplyErr(e.message || "Apply failed");
      } finally {
        setApplying(false);
      }
    }

    if (applyDone) {
      return ce("div", { className: "ss-row ss-row-done" },
        ce("div", { className: "ss-row-done-msg" },
          ce(IconCheck), " Applied — ", ce("code", null, basename(item.original_path))
        )
      );
    }

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
          ? ce(FilenameEditor, {
              item,
              overrideStem,
              onChangeStem,
            })
          : ce("div", { className: "ss-no-rename" }, "Filename unchanged — tags only"),

        // Tags + junk chips
        (newTags.length > 0 || existingTags.length > 0 || junkTokens.length > 0 || promotedTags.length > 0) &&
          ce("div", { className: "ss-tags-row" },
            newTags.map(t => ce(TagChip, { key: t.tag_id, name: t.tag_name, isNew: true })),
            promotedTags.map(t => ce(TagChip, { key: t.tag_id, name: t.tag_name, isNew: true })),
            existingTags.map(t => ce(TagChip, { key: t.tag_id, name: t.tag_name, isNew: false })),
            strippedJunk && junkTokens.map(t =>
              ce(JunkChip, {
                key: t.raw,
                raw: t.raw,
                phrase: t.phrase,
                onPromote: handlePromote,
                promoting: promoting === t.raw,
              })
            )
          ),

        applyErr && ce("div", { className: "ss-row-err" }, applyErr)
      ),

      // Per-row actions
      ce("div", { className: "ss-row-actions" },
        // Apply this one button
        ce("button", {
          className: "ss-icon-btn ss-icon-btn-apply",
          title: "Apply this scene only",
          disabled: applying,
          onClick: handleApplyThis,
        },
          applying ? ce(IconSpinner) : ce(IconPlay)
        ),
        // Select toggle
        ce("button", {
          className: `ss-icon-btn ${selected ? "ss-icon-btn-active" : ""}`,
          onClick: onToggle,
          title: selected ? "Deselect" : "Select for bulk apply",
        }, selected ? ce(IconX) : ce(IconCheck))
      )
    );
  }

  // ── Main Modal ────────────────────────────────────────────────────────────────

  function SanitizeModal({ onClose }) {
    const [phase, setPhase]             = useState("idle");
    const [scanStatus, setScanStatus]   = useState(null);
    const [report, setReport]           = useState(null);
    // Map of scene_id → override stem string (if user edited)
    const [stemOverrides, setStemOverrides] = useState({});
    // Map of scene_id → extra tag ids added via junk promotion
    const [extraTags, setExtraTags]     = useState({});
    const [selected, setSelected]       = useState(new Set());
    const [applyMsg, setApplyMsg]       = useState("");
    const [errorMsg, setErrorMsg]       = useState("");
    const [filter, setFilter]           = useState("all");
    const [search, setSearch]           = useState("");
    // Set of scene_ids that have been individually applied
    const [appliedIds, setAppliedIds]   = useState(new Set());
    const cancelRef = useRef(null);

    useEffect(() => {
      document.body.style.overflow = "hidden";
      fetchAssetJSON("sanitize_report.json").then(data => {
        if (data && data.status === "done" && data.pending && data.pending.length > 0) {
          setReport(data);
          setSelected(new Set(data.pending.map(p => p.scene_id)));
          setPhase("review");
        }
      }).catch(() => {});
      return () => { document.body.style.overflow = ""; };
    }, []);

    // ── Scan ──────────────────────────────────────────────────────────────────

    async function handleScan() {
      if (cancelRef.current) cancelRef.current();
      setPhase("scanning");
      setScanStatus({ status: "running", message: "Starting scan…", progress: 0 });
      setReport(null);
      setSelected(new Set());
      setStemOverrides({});
      setExtraTags({});
      setAppliedIds(new Set());
      setErrorMsg("");
      setApplyMsg("");

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

    // ── Per-row callback: add_tag or apply ────────────────────────────────────

    /**
     * Called by SceneRow for two purposes:
     *   mode="add_tag" → store an extra promoted tag for this scene
     *   mode="apply"   → actually apply just this one scene
     */
    async function handleRowAction(sceneId, mode, payload) {
      if (mode === "add_tag") {
        setExtraTags(prev => ({
          ...prev,
          [sceneId]: [...(prev[sceneId] || []), payload.tag_id],
        }));
        return;
      }

      if (mode === "apply") {
        // Build the effective item
        const item = (report.pending || []).find(p => p.scene_id === sceneId);
        if (!item) return;

        const overrideStem = payload.overrideStem;
        const ext          = basename(item.original_path).includes(".")
          ? basename(item.original_path).slice(basename(item.original_path).lastIndexOf("."))
          : "";
        const effectiveStem = (overrideStem !== undefined && overrideStem !== item.new_stem)
          ? overrideStem
          : item.new_stem;
        const newBasename  = effectiveStem + ext;
        const newPath      = dirname(item.original_path) + "/" + newBasename;

        // Merge any promoted tag ids
        const promoted = extraTags[sceneId] || [];
        const allTagIds = [...new Set([...item.all_tag_ids, ...promoted])];

        // Fire apply for this single scene via plugin task, passing custom path too
        // We send it as a single scene_ids and override via a custom arg
        // Actually: we build a mini-apply payload and do it ourselves via GraphQL
        // because the python task has no way to receive a per-scene new_path override.
        // So we'll call the mutations directly from JS.
        await applySingleScene(item, newPath, allTagIds);
        setAppliedIds(prev => new Set([...prev, sceneId]));
        // Remove from pending in local state
        setReport(prev => ({
          ...prev,
          pending: (prev.pending || []).filter(p => p.scene_id !== sceneId),
        }));
        setSelected(prev => { const n = new Set(prev); n.delete(sceneId); return n; });
      }
    }

    /**
     * Apply a single scene directly via GraphQL mutations (no Python needed).
     * This lets us pass arbitrary new_path without modifying the Python plugin.
     */
    async function applySingleScene(item, newPath, allTagIds) {
      // 1. Rename file if needed
      if (item.filename_changes && item.original_path !== newPath) {
        await gqlQuery(`
          mutation MoveFiles($input: MoveFilesInput!) {
            moveFiles(input: $input)
          }
        `, { input: { ids: [item.file_id], destination: newPath } });
      }

      // 2. Build new title
      let newTitle = item.scene_title || "";
      const tokensToStrip = [...(item.matched_tokens || [])];
      if (item.stripped_unmatched) tokensToStrip.push(...(item.unmatched_tokens || []));
      for (const tok of tokensToStrip) {
        newTitle = newTitle.replace(new RegExp(escapeRegex(tok.raw), "gi"), "");
      }
      newTitle = newTitle.replace(/\s+/g, " ").trim() || basename(newPath).replace(/\.[^.]+$/, "");

      // 3. Update scene
      await gqlQuery(`
        mutation SceneUpdate($input: SceneUpdateInput!) {
          sceneUpdate(input: $input) { id }
        }
      `, { input: { id: item.scene_id, title: newTitle, tag_ids: allTagIds } });
    }

    function escapeRegex(str) {
      return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    // ── Bulk apply ────────────────────────────────────────────────────────────

    async function handleApply() {
      if (!report || selected.size === 0) return;
      setPhase("applying");
      setApplyMsg("Applying changes…");
      setErrorMsg("");

      const toApply = (report.pending || []).filter(p => selected.has(p.scene_id));
      let done = 0, errors = 0;

      for (const item of toApply) {
        try {
          const overrideStem = stemOverrides[item.scene_id];
          const ext = basename(item.original_path).includes(".")
            ? basename(item.original_path).slice(basename(item.original_path).lastIndexOf("."))
            : "";
          const effectiveStem = (overrideStem !== undefined) ? overrideStem : item.new_stem;
          const newPath = dirname(item.original_path) + "/" + effectiveStem + ext;
          const promoted = extraTags[item.scene_id] || [];
          const allTagIds = [...new Set([...item.all_tag_ids, ...promoted])];
          await applySingleScene(item, newPath, allTagIds);
          done++;
        } catch (e) {
          WARN("Apply error for scene", item.scene_id, e);
          errors++;
        }
      }

      // Remove applied from local pending
      setReport(prev => ({
        ...prev,
        pending: (prev.pending || []).filter(p => !selected.has(p.scene_id)),
      }));
      setSelected(new Set());
      setApplyMsg(`Applied ${done} change${done !== 1 ? "s" : ""}${errors ? `, ${errors} errors` : ""}. Run a library scan to update Stash.`);
      setPhase("done");
    }

    // ── Selection helpers ─────────────────────────────────────────────────────

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

    // ── Derived data ──────────────────────────────────────────────────────────

    const pending  = (report && report.pending) || [];
    const filtered = pending.filter(p => {
      if (filter === "filename" && !p.filename_changes) return false;
      if (filter === "tagsonly" &&  p.filename_changes) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!(p.scene_title + p.original_path).toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const allFilteredSelected = filtered.length > 0 && filtered.every(p => selected.has(p.scene_id));

    // ── Render ────────────────────────────────────────────────────────────────

    return ce("div", { className: "ss-overlay", onClick: e => { if (e.target === e.currentTarget) onClose(); } },
      ce("div", { className: "ss-modal" },

        // Header
        ce("div", { className: "ss-modal-header" },
          ce("div", { className: "ss-header-left" },
            ce("h2", null, "Filename Sanitizer"),
            ce("p", { className: "ss-subtitle" },
              "Detect tag-like tokens in filenames, strip them, rename files, and add Stash tags."
            )
          ),
          ce("button", { className: "ss-close-btn", onClick: onClose }, ce(IconX))
        ),

        // Scan bar
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

        // Error bar
        errorMsg && ce("div", { className: "ss-error-bar" }, errorMsg),

        // Success bar
        phase === "done" && applyMsg && ce("div", { className: "ss-success-bar" }, applyMsg),

        // Review table
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
                    onApplyOne: handleRowAction,
                    overrideStem: stemOverrides[item.scene_id],
                    onChangeStem: val => setStemOverrides(prev => ({ ...prev, [item.scene_id]: val })),
                  })
                )
          )
        ),

        pending.length === 0 && (phase === "review" || phase === "done") && ce("div", { className: "ss-empty-state" },
          "✓ No scenes need sanitization."
        ),

        // Action bar
        (phase === "review" || phase === "applying" || phase === "done") && pending.length > 0 &&
          ce("div", { className: "ss-action-bar" },
            phase === "applying"
              ? ce("div", { className: "ss-applying-msg" },
                  ce(IconSpinner),
                  applyMsg || "Applying changes…"
                )
              : ce("button", {
                  className: "ss-btn ss-btn-primary",
                  onClick: handleApply,
                  disabled: selected.size === 0 || phase !== "review",
                }, `Apply ${selected.size} Selected`),

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