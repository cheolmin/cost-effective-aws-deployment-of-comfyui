import { app } from "../../../scripts/app.js";

var CHUNK_SIZE = 100 * 1024 * 1024; // 100MB per chunk

app.registerExtension({
    name: "ComfyUI.ModelUploader",

    async setup() {
        var btn = document.createElement("button");
        btn.textContent = "Upload Model";
        btn.onclick = function() { showUploadDialog(); };

        function styleAsMenuButton(b) {
            b.style.cssText = [
                "padding: 4px 10px",
                "background: #4a9eff",
                "color: #fff",
                "border: none",
                "border-radius: 4px",
                "cursor: pointer",
                "font-size: 13px",
                "font-family: sans-serif",
                "font-weight: 500",
                "transition: background 0.2s",
                "margin-left: 4px",
                "height: 100%",
                "white-space: nowrap",
            ].join(";");
            b.onmouseenter = function() { this.style.background = "#3a8eef"; };
            b.onmouseleave = function() { this.style.background = "#4a9eff"; };
        }

        function styleAsFloating(b) {
            b.style.cssText = [
                "position: fixed",
                "top: 4px",
                "right: 4px",
                "z-index: 9999",
                "padding: 6px 14px",
                "background: #4a9eff",
                "color: #fff",
                "border: none",
                "border-radius: 6px",
                "cursor: pointer",
                "font-size: 13px",
                "font-family: sans-serif",
                "font-weight: 500",
                "box-shadow: 0 2px 8px rgba(0,0,0,0.3)",
                "transition: background 0.2s",
                "pointer-events: auto",
            ].join(";");
            b.onmouseenter = function() { this.style.background = "#3a8eef"; };
            b.onmouseleave = function() { this.style.background = "#4a9eff"; };
        }

        function tryInsertInMenu() {
            // Look for ComfyUI Manager button or the top menu actions area
            var managerBtn = document.querySelector(".manager-button, #comfyui-manager-button");
            if (managerBtn && managerBtn.parentElement) {
                styleAsMenuButton(btn);
                managerBtn.parentElement.insertBefore(btn, managerBtn.nextSibling);
                return true;
            }
            // New Vue frontend: look for the top menu-bar actions container
            var menuActions = document.querySelector(".comfyui-menu .comfyui-menu-push")
                || document.querySelector(".comfyui-menu-push")
                || document.querySelector("[class*='actionbar']")
                || document.querySelector(".p-menubar-end");
            if (menuActions) {
                styleAsMenuButton(btn);
                menuActions.appendChild(btn);
                return true;
            }
            return false;
        }

        // Try immediately, then observe DOM for late-loading menu
        if (!tryInsertInMenu()) {
            // Fallback: floating top-right (avoids bottom-right overlap)
            styleAsFloating(btn);
            document.body.appendChild(btn);

            // Keep watching for menu to appear (e.g., after Manager loads)
            var observer = new MutationObserver(function() {
                if (btn.parentElement === document.body && tryInsertInMenu()) {
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            // Stop watching after 30s to avoid leaks
            setTimeout(function() { observer.disconnect(); }, 30000);
        }
    },
});

/* ── Shared state ── */
var currentTab = "upload";
var fileBrowserDir = "";
var fileBrowserSubfolder = "";
var fileBrowserDirs = [];

/* ── Main dialog ── */
async function showUploadDialog() {
    var existing = document.getElementById("model-upload-dialog");
    if (existing) existing.remove();

    var dirs = [];
    try {
        var res = await fetch("/api/model-upload/dirs");
        var data = await res.json();
        dirs = data.dirs || [];
    } catch (e) {
        alert("Failed to connect to upload API");
        return;
    }
    fileBrowserDirs = dirs;

    var overlay = document.createElement("div");
    overlay.id = "model-upload-dialog";
    overlay.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:10000;display:flex;align-items:center;justify-content:center;";

    var dialog = document.createElement("div");
    dialog.style.cssText = "background:#2a2a2a;color:#eee;border-radius:8px;padding:0;min-width:520px;max-width:600px;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:sans-serif;overflow:hidden;";

    /* Tab bar */
    var tabBar = document.createElement("div");
    tabBar.style.cssText = "display:flex;border-bottom:1px solid #444;";
    tabBar.innerHTML = '<button id="mu-tab-upload" style="flex:1;padding:12px;background:#333;color:#eee;border:none;cursor:pointer;font-size:14px;border-bottom:2px solid #4a9eff;">Upload</button>'
        + '<button id="mu-tab-browse" style="flex:1;padding:12px;background:#2a2a2a;color:#888;border:none;cursor:pointer;font-size:14px;border-bottom:2px solid transparent;">File Manager</button>';

    /* Content area */
    var content = document.createElement("div");
    content.id = "mu-content";
    content.style.cssText = "padding:24px;";

    dialog.appendChild(tabBar);
    dialog.appendChild(content);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    document.getElementById("mu-tab-upload").onclick = function() {
        currentTab = "upload";
        setActiveTab("upload");
        renderUploadTab(content, dirs);
    };
    document.getElementById("mu-tab-browse").onclick = function() {
        currentTab = "browse";
        setActiveTab("browse");
        fileBrowserDir = dirs[0] || "";
        fileBrowserSubfolder = "";
        renderBrowseTab(content, dirs);
    };

    renderUploadTab(content, dirs);
}

function setActiveTab(tab) {
    var uploadTab = document.getElementById("mu-tab-upload");
    var browseTab = document.getElementById("mu-tab-browse");
    if (tab === "upload") {
        uploadTab.style.background = "#333";
        uploadTab.style.color = "#eee";
        uploadTab.style.borderBottom = "2px solid #4a9eff";
        browseTab.style.background = "#2a2a2a";
        browseTab.style.color = "#888";
        browseTab.style.borderBottom = "2px solid transparent";
    } else {
        browseTab.style.background = "#333";
        browseTab.style.color = "#eee";
        browseTab.style.borderBottom = "2px solid #4a9eff";
        uploadTab.style.background = "#2a2a2a";
        uploadTab.style.color = "#888";
        uploadTab.style.borderBottom = "2px solid transparent";
    }
}

/* ── Upload Tab ── */
function renderUploadTab(container, dirs) {
    var optionsHtml = "";
    for (var i = 0; i < dirs.length; i++) {
        optionsHtml += '<option value="' + dirs[i] + '">' + dirs[i] + "</option>";
    }

    container.innerHTML = '<div style="margin-bottom:12px;">'
        + '<label style="display:block;margin-bottom:4px;font-size:13px;color:#aaa;">Target Directory</label>'
        + '<select id="mu-target-dir" style="width:100%;padding:8px;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;font-size:14px;">'
        + optionsHtml
        + '</select></div>'
        + '<div style="margin-bottom:16px;">'
        + '<label style="display:block;margin-bottom:4px;font-size:13px;color:#aaa;">Select File</label>'
        + '<input type="file" id="mu-file-input" style="width:100%;padding:8px;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;font-size:14px;" /></div>'
        + '<div id="mu-file-info" style="margin-bottom:16px;font-size:13px;color:#888;display:none;">'
        + '<span id="mu-file-name"></span> &mdash; <span id="mu-file-size"></span></div>'
        + '<div id="mu-progress-area" style="display:none;margin-bottom:16px;">'
        + '<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">'
        + '<span id="mu-progress-text">Uploading...</span>'
        + '<span id="mu-progress-pct">0%</span></div>'
        + '<div style="width:100%;height:8px;background:#1a1a1a;border-radius:4px;overflow:hidden;">'
        + '<div id="mu-progress-bar" style="width:0%;height:100%;background:#4a9eff;transition:width 0.2s;"></div></div>'
        + '<div id="mu-speed-info" style="font-size:12px;color:#666;margin-top:4px;"></div></div>'
        + '<div id="mu-result" style="display:none;margin-bottom:16px;padding:12px;border-radius:4px;font-size:13px;"></div>'
        + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
        + '<button id="mu-cancel-btn" style="padding:8px 16px;background:#444;color:#eee;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Close</button>'
        + '<button id="mu-upload-btn" style="padding:8px 16px;background:#4a9eff;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:14px;" disabled>Upload</button></div>';

    var fileInput = document.getElementById("mu-file-input");
    var uploadBtn = document.getElementById("mu-upload-btn");
    var cancelBtn = document.getElementById("mu-cancel-btn");
    var currentSessionId = null;
    var cancelled = false;

    fileInput.onchange = function() {
        var file = fileInput.files[0];
        if (file) {
            document.getElementById("mu-file-name").textContent = file.name;
            document.getElementById("mu-file-size").textContent = formatSize(file.size);
            document.getElementById("mu-file-info").style.display = "block";
            uploadBtn.disabled = false;
        }
    };

    cancelBtn.onclick = function() {
        if (currentSessionId) {
            cancelled = true;
            fetch("/api/model-upload/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: currentSessionId }) }).catch(function() {});
        }
        document.getElementById("model-upload-dialog").remove();
    };

    uploadBtn.onclick = function() {
        var file = fileInput.files[0];
        if (!file) return;
        var targetDir = document.getElementById("mu-target-dir").value;
        cancelled = false;
        doUpload(file, targetDir, function(sid) { currentSessionId = sid; }, function() { return cancelled; });
    };
}

async function doUpload(file, targetDir, onSession, isCancelled) {
    var uploadBtn = document.getElementById("mu-upload-btn");
    var fileInput = document.getElementById("mu-file-input");
    var totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    uploadBtn.disabled = true;
    fileInput.disabled = true;
    document.getElementById("mu-target-dir").disabled = true;
    document.getElementById("mu-progress-area").style.display = "block";
    document.getElementById("mu-result").style.display = "none";

    var sessionId = null;
    try {
        var initRes = await fetch("/api/model-upload/init", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, target_dir: targetDir, total_size: file.size, total_chunks: totalChunks }),
        });
        var initData = await initRes.json();
        if (initData.error) throw new Error(initData.error);
        sessionId = initData.session_id;
        onSession(sessionId);
    } catch (e) {
        showResult("Init failed: " + e.message, true);
        resetUploadForm();
        return;
    }

    var startTime = Date.now();
    var uploadedBytes = 0;

    for (var i = 0; i < totalChunks; i++) {
        if (isCancelled()) return;
        var start = i * CHUNK_SIZE;
        var end = Math.min(start + CHUNK_SIZE, file.size);
        var chunk = file.slice(start, end);

        var formData = new FormData();
        formData.append("session_id", sessionId);
        formData.append("chunk_index", i.toString());
        formData.append("chunk", chunk);

        try {
            var chunkRes = await fetch("/api/model-upload/chunk", { method: "POST", body: formData });
            var chunkData = await chunkRes.json();
            if (chunkData.error) throw new Error(chunkData.error);
        } catch (e) {
            showResult("Chunk " + i + " failed: " + e.message, true);
            resetUploadForm();
            return;
        }

        uploadedBytes += (end - start);
        var pct = Math.round((uploadedBytes / file.size) * 100);
        var elapsed = (Date.now() - startTime) / 1000;
        var speed = uploadedBytes / elapsed;
        var remaining = (file.size - uploadedBytes) / speed;

        document.getElementById("mu-progress-bar").style.width = pct + "%";
        document.getElementById("mu-progress-pct").textContent = pct + "%";
        document.getElementById("mu-progress-text").textContent = "Uploading... (" + (i + 1) + "/" + totalChunks + " chunks)";
        document.getElementById("mu-speed-info").textContent = formatSize(speed) + "/s - " + formatTime(remaining) + " remaining";
    }

    try {
        document.getElementById("mu-progress-text").textContent = "Merging chunks...";
        var completeRes = await fetch("/api/model-upload/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: sessionId }),
        });
        var completeData = await completeRes.json();
        if (completeData.error) throw new Error(completeData.error);
        var totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        showResult("Upload complete: " + file.name + " (" + formatSize(file.size) + ") in " + totalElapsed + "s", false);
    } catch (e) {
        showResult("Complete failed: " + e.message, true);
    }
    resetUploadForm();
}

function resetUploadForm() {
    var btn = document.getElementById("mu-upload-btn");
    var input = document.getElementById("mu-file-input");
    var dir = document.getElementById("mu-target-dir");
    if (btn) btn.disabled = false;
    if (input) input.disabled = false;
    if (dir) dir.disabled = false;
}

function showResult(msg, isError) {
    var el = document.getElementById("mu-result");
    if (!el) return;
    el.style.display = "block";
    el.style.background = isError ? "#3a1a1a" : "#1a3a1a";
    el.style.color = isError ? "#ff6b6b" : "#6bff6b";
    el.textContent = msg;
}

/* ── File Manager Tab ── */
function renderBrowseTab(container, dirs) {
    var optionsHtml = "";
    for (var i = 0; i < dirs.length; i++) {
        var sel = dirs[i] === fileBrowserDir ? " selected" : "";
        optionsHtml += '<option value="' + dirs[i] + '"' + sel + '>' + dirs[i] + "</option>";
    }

    container.innerHTML = '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;">'
        + '<select id="mu-browse-dir" style="flex:1;padding:8px;background:#1a1a1a;color:#eee;border:1px solid #444;border-radius:4px;font-size:14px;">'
        + optionsHtml + '</select>'
        + '<button id="mu-mkdir-btn" style="padding:8px 12px;background:#2d8a4e;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;white-space:nowrap;">New Folder</button></div>'
        + '<div id="mu-browse-path" style="font-size:12px;color:#666;margin-bottom:8px;"></div>'
        + '<div id="mu-file-list" style="max-height:360px;overflow-y:auto;border:1px solid #444;border-radius:4px;background:#1a1a1a;"></div>'
        + '<div id="mu-browse-msg" style="display:none;margin-top:8px;padding:8px;border-radius:4px;font-size:13px;"></div>'
        + '<div style="display:flex;justify-content:flex-end;margin-top:12px;">'
        + '<button id="mu-browse-close" style="padding:8px 16px;background:#444;color:#eee;border:none;border-radius:4px;cursor:pointer;font-size:14px;">Close</button></div>';

    document.getElementById("mu-browse-dir").onchange = function() {
        fileBrowserDir = this.value;
        fileBrowserSubfolder = "";
        loadFileList();
    };

    document.getElementById("mu-mkdir-btn").onclick = function() { promptMkdir(); };
    document.getElementById("mu-browse-close").onclick = function() {
        document.getElementById("model-upload-dialog").remove();
    };

    loadFileList();
}

async function loadFileList() {
    var listEl = document.getElementById("mu-file-list");
    var pathEl = document.getElementById("mu-browse-path");
    if (!listEl) return;

    var displayPath = fileBrowserDir + (fileBrowserSubfolder ? "/" + fileBrowserSubfolder : "");
    pathEl.textContent = displayPath;

    listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#666;">Loading...</div>';

    var url = "/api/model-upload/files?dir=" + encodeURIComponent(fileBrowserDir);
    if (fileBrowserSubfolder) url += "&subfolder=" + encodeURIComponent(fileBrowserSubfolder);

    try {
        var res = await fetch(url);
        var data = await res.json();
        if (data.error) throw new Error(data.error);
        renderFileList(data.items || []);
    } catch (e) {
        listEl.innerHTML = '<div style="padding:16px;color:#ff6b6b;">Error: ' + e.message + '</div>';
    }
}

function renderFileList(items) {
    var listEl = document.getElementById("mu-file-list");
    if (!listEl) return;

    if (items.length === 0 && !fileBrowserSubfolder) {
        listEl.innerHTML = '<div style="padding:16px;text-align:center;color:#666;">Empty directory</div>';
        return;
    }

    var html = "";

    // Back button when in subfolder
    if (fileBrowserSubfolder) {
        html += '<div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #333;cursor:pointer;" class="mu-file-row" data-action="back">'
            + '<span style="margin-right:8px;">&#x2190;</span>'
            + '<span style="flex:1;color:#4a9eff;">..</span></div>';
    }

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var icon = item.type === "dir" ? "&#x1F4C1;" : "&#x1F4C4;";
        var sizeText = item.type === "file" ? formatSize(item.size) : "";

        html += '<div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid #333;" class="mu-file-row">'
            + '<span style="margin-right:8px;">' + icon + '</span>'
            + '<span style="flex:1;cursor:' + (item.type === "dir" ? "pointer" : "default") + ';' + (item.type === "dir" ? "color:#4a9eff;" : "") + '" class="mu-file-name" data-type="' + item.type + '" data-name="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span>'
            + '<span style="font-size:12px;color:#666;margin-right:12px;min-width:70px;text-align:right;">' + sizeText + '</span>'
            + '<button class="mu-delete-btn" data-name="' + escapeHtml(item.name) + '" data-type="' + item.type + '" style="padding:4px 8px;background:#6b2a2a;color:#ff6b6b;border:none;border-radius:3px;cursor:pointer;font-size:12px;">Delete</button>'
            + '</div>';
    }

    if (items.length === 0) {
        html += '<div style="padding:16px;text-align:center;color:#666;">Empty directory</div>';
    }

    listEl.innerHTML = html;

    // Attach click handlers for directory navigation
    var nameEls = listEl.querySelectorAll(".mu-file-name[data-type='dir']");
    for (var i = 0; i < nameEls.length; i++) {
        nameEls[i].onclick = function() {
            var dirName = this.getAttribute("data-name");
            fileBrowserSubfolder = fileBrowserSubfolder ? fileBrowserSubfolder + "/" + dirName : dirName;
            loadFileList();
        };
    }

    // Back button handler
    var backRow = listEl.querySelector("[data-action='back']");
    if (backRow) {
        backRow.onclick = function() {
            var parts = fileBrowserSubfolder.split("/");
            parts.pop();
            fileBrowserSubfolder = parts.join("/");
            loadFileList();
        };
    }

    // Delete handlers
    var delBtns = listEl.querySelectorAll(".mu-delete-btn");
    for (var i = 0; i < delBtns.length; i++) {
        delBtns[i].onclick = function(e) {
            e.stopPropagation();
            var name = this.getAttribute("data-name");
            var type = this.getAttribute("data-type");
            confirmDelete(name, type);
        };
    }
}

async function confirmDelete(name, type) {
    var label = type === "dir" ? 'folder "' + name + '" and all its contents' : 'file "' + name + '"';
    if (!confirm("Delete " + label + "?")) return;

    var msgEl = document.getElementById("mu-browse-msg");

    try {
        var res = await fetch("/api/model-upload/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_dir: fileBrowserDir, subfolder: fileBrowserSubfolder, filename: name }),
        });
        var data = await res.json();
        if (data.error) throw new Error(data.error);
        if (msgEl) {
            msgEl.style.display = "block";
            msgEl.style.background = "#1a3a1a";
            msgEl.style.color = "#6bff6b";
            msgEl.textContent = "Deleted: " + name;
        }
        loadFileList();
    } catch (e) {
        if (msgEl) {
            msgEl.style.display = "block";
            msgEl.style.background = "#3a1a1a";
            msgEl.style.color = "#ff6b6b";
            msgEl.textContent = "Delete failed: " + e.message;
        }
    }
}

function promptMkdir() {
    var name = prompt("New folder name:");
    if (!name || !name.trim()) return;
    name = name.trim();

    fetch("/api/model-upload/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_dir: fileBrowserDir, subfolder: fileBrowserSubfolder, folder_name: name }),
    })
    .then(function(res) { return res.json(); })
    .then(function(data) {
        var msgEl = document.getElementById("mu-browse-msg");
        if (data.error) {
            if (msgEl) {
                msgEl.style.display = "block";
                msgEl.style.background = "#3a1a1a";
                msgEl.style.color = "#ff6b6b";
                msgEl.textContent = "Failed: " + data.error;
            }
        } else {
            if (msgEl) {
                msgEl.style.display = "block";
                msgEl.style.background = "#1a3a1a";
                msgEl.style.color = "#6bff6b";
                msgEl.textContent = "Created: " + name;
            }
            loadFileList();
        }
    })
    .catch(function(e) {
        alert("Error: " + e.message);
    });
}

/* ── Utilities ── */
function escapeHtml(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function formatTime(seconds) {
    if (seconds < 60) return Math.round(seconds) + "s";
    if (seconds < 3600) return Math.round(seconds / 60) + "m " + Math.round(seconds % 60) + "s";
    return Math.round(seconds / 3600) + "h " + Math.round((seconds % 3600) / 60) + "m";
}
