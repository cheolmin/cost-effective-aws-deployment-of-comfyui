import { app } from "../../../scripts/app.js";

const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB per chunk

app.registerExtension({
    name: "ComfyUI.ModelUploader",

    async setup() {
        // Add upload button to the menu
        const menu = document.querySelector(".comfy-menu");
        if (!menu) return;

        const separator = document.createElement("hr");
        separator.style.margin = "4px 0";
        separator.style.width = "100%";
        menu.append(separator);

        const uploadBtn = document.createElement("button");
        uploadBtn.textContent = "Upload Model";
        uploadBtn.style.cursor = "pointer";
        uploadBtn.onclick = () => showUploadDialog();
        menu.append(uploadBtn);
    },
});

async function showUploadDialog() {
    // Remove existing dialog
    const existing = document.getElementById("model-upload-dialog");
    if (existing) existing.remove();

    // Fetch available directories
    let dirs = [];
    try {
        const res = await fetch("/api/model-upload/dirs");
        const data = await res.json();
        dirs = data.dirs || [];
    } catch (e) {
        alert("Failed to connect to upload API");
        return;
    }

    // Create dialog overlay
    const overlay = document.createElement("div");
    overlay.id = "model-upload-dialog";
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.6); z-index: 10000;
        display: flex; align-items: center; justify-content: center;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
        background: #2a2a2a; color: #eee; border-radius: 8px; padding: 24px;
        min-width: 480px; max-width: 560px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);
        font-family: sans-serif;
    `;

    dialog.innerHTML = `
        <h3 style="margin: 0 0 16px 0; font-size: 18px;">Model Upload</h3>
        <div style="margin-bottom: 12px;">
            <label style="display: block; margin-bottom: 4px; font-size: 13px; color: #aaa;">Target Directory</label>
            <select id="mu-target-dir" style="width: 100%; padding: 8px; background: #1a1a1a; color: #eee; border: 1px solid #444; border-radius: 4px; font-size: 14px;">
                ${dirs.map(d => `<option value="${d}">${d}</option>`).join("")}
            </select>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="display: block; margin-bottom: 4px; font-size: 13px; color: #aaa;">Select File</label>
            <input type="file" id="mu-file-input" style="width: 100%; padding: 8px; background: #1a1a1a; color: #eee; border: 1px solid #444; border-radius: 4px; font-size: 14px;" />
        </div>
        <div id="mu-file-info" style="margin-bottom: 16px; font-size: 13px; color: #888; display: none;">
            <span id="mu-file-name"></span> — <span id="mu-file-size"></span>
        </div>
        <div id="mu-progress-area" style="display: none; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                <span id="mu-progress-text">Uploading...</span>
                <span id="mu-progress-pct">0%</span>
            </div>
            <div style="width: 100%; height: 8px; background: #1a1a1a; border-radius: 4px; overflow: hidden;">
                <div id="mu-progress-bar" style="width: 0%; height: 100%; background: #4a9eff; transition: width 0.2s;"></div>
            </div>
            <div id="mu-speed-info" style="font-size: 12px; color: #666; margin-top: 4px;"></div>
        </div>
        <div id="mu-result" style="display: none; margin-bottom: 16px; padding: 12px; border-radius: 4px; font-size: 13px;"></div>
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
            <button id="mu-cancel-btn" style="padding: 8px 16px; background: #444; color: #eee; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Close</button>
            <button id="mu-upload-btn" style="padding: 8px 16px; background: #4a9eff; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;" disabled>Upload</button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Event handlers
    const fileInput = document.getElementById("mu-file-input");
    const uploadBtn = document.getElementById("mu-upload-btn");
    const cancelBtn = document.getElementById("mu-cancel-btn");
    const fileInfo = document.getElementById("mu-file-info");

    let currentSessionId = null;
    let cancelled = false;

    overlay.onclick = (e) => { if (e.target === overlay) closeDialog(); };

    fileInput.onchange = () => {
        const file = fileInput.files[0];
        if (file) {
            document.getElementById("mu-file-name").textContent = file.name;
            document.getElementById("mu-file-size").textContent = formatSize(file.size);
            fileInfo.style.display = "block";
            uploadBtn.disabled = false;
        }
    };

    cancelBtn.onclick = async () => {
        if (currentSessionId) {
            cancelled = true;
            try { await fetch("/api/model-upload/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: currentSessionId }) }); } catch {}
        }
        closeDialog();
    };

    uploadBtn.onclick = () => startUpload();

    function closeDialog() {
        overlay.remove();
    }

    async function startUpload() {
        const file = fileInput.files[0];
        if (!file) return;

        const targetDir = document.getElementById("mu-target-dir").value;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        uploadBtn.disabled = true;
        fileInput.disabled = true;
        document.getElementById("mu-target-dir").disabled = true;
        document.getElementById("mu-progress-area").style.display = "block";
        document.getElementById("mu-result").style.display = "none";
        cancelled = false;

        // Init session
        try {
            const initRes = await fetch("/api/model-upload/init", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    filename: file.name,
                    target_dir: targetDir,
                    total_size: file.size,
                    total_chunks: totalChunks,
                }),
            });
            const initData = await initRes.json();
            if (initData.error) throw new Error(initData.error);
            currentSessionId = initData.session_id;
        } catch (e) {
            showResult(`Init failed: ${e.message}`, true);
            resetForm();
            return;
        }

        // Upload chunks
        const startTime = Date.now();
        let uploadedBytes = 0;

        for (let i = 0; i < totalChunks; i++) {
            if (cancelled) return;

            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);

            const formData = new FormData();
            formData.append("session_id", currentSessionId);
            formData.append("chunk_index", i.toString());
            formData.append("chunk", chunk);

            try {
                const res = await fetch("/api/model-upload/chunk", { method: "POST", body: formData });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
            } catch (e) {
                showResult(`Chunk ${i} failed: ${e.message}`, true);
                resetForm();
                return;
            }

            uploadedBytes += (end - start);
            const pct = Math.round((uploadedBytes / file.size) * 100);
            const elapsed = (Date.now() - startTime) / 1000;
            const speed = uploadedBytes / elapsed;
            const remaining = (file.size - uploadedBytes) / speed;

            document.getElementById("mu-progress-bar").style.width = `${pct}%`;
            document.getElementById("mu-progress-pct").textContent = `${pct}%`;
            document.getElementById("mu-progress-text").textContent = `Uploading... (${i + 1}/${totalChunks} chunks)`;
            document.getElementById("mu-speed-info").textContent = `${formatSize(speed)}/s - ${formatTime(remaining)} remaining`;
        }

        // Complete
        try {
            document.getElementById("mu-progress-text").textContent = "Merging chunks...";
            const completeRes = await fetch("/api/model-upload/complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: currentSessionId }),
            });
            const completeData = await completeRes.json();
            if (completeData.error) throw new Error(completeData.error);

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            showResult(`Upload complete: ${file.name} (${formatSize(file.size)}) in ${elapsed}s`, false);
        } catch (e) {
            showResult(`Complete failed: ${e.message}`, true);
        }

        currentSessionId = null;
        resetForm();
    }

    function resetForm() {
        uploadBtn.disabled = false;
        fileInput.disabled = false;
        document.getElementById("mu-target-dir").disabled = false;
    }

    function showResult(msg, isError) {
        const el = document.getElementById("mu-result");
        el.style.display = "block";
        el.style.background = isError ? "#3a1a1a" : "#1a3a1a";
        el.style.color = isError ? "#ff6b6b" : "#6bff6b";
        el.textContent = msg;
    }
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
