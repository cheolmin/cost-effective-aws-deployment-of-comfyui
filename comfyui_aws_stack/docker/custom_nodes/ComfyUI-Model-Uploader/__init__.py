import server
import os
import uuid
import json
import shutil
from aiohttp import web

COMFYUI_PATH = os.environ.get("COMFYUI_PATH", os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
MODELS_BASE = os.path.join(COMFYUI_PATH, "models")
INPUT_PATH = os.path.join(COMFYUI_PATH, "input")
TEMP_PATH = os.path.join(COMFYUI_PATH, "temp_uploads")

MODEL_DIRS = {
    "checkpoints": os.path.join(MODELS_BASE, "checkpoints"),
    "clip": os.path.join(MODELS_BASE, "clip"),
    "clip_vision": os.path.join(MODELS_BASE, "clip_vision"),
    "controlnet": os.path.join(MODELS_BASE, "controlnet"),
    "diffusion_models": os.path.join(MODELS_BASE, "diffusion_models"),
    "embeddings": os.path.join(MODELS_BASE, "embeddings"),
    "loras": os.path.join(MODELS_BASE, "loras"),
    "unet": os.path.join(MODELS_BASE, "unet"),
    "upscale_models": os.path.join(MODELS_BASE, "upscale_models"),
    "vae": os.path.join(MODELS_BASE, "vae"),
    "input": INPUT_PATH,
}

# Track active upload sessions
upload_sessions = {}


@server.PromptServer.instance.routes.get("/api/model-upload/dirs")
async def get_model_dirs(request):
    """Return available model directories."""
    dirs = {}
    for name, path in MODEL_DIRS.items():
        os.makedirs(path, exist_ok=True)
        dirs[name] = path
    return web.json_response({"dirs": list(dirs.keys())})


@server.PromptServer.instance.routes.post("/api/model-upload/init")
async def upload_init(request):
    """Initialize a chunked upload session."""
    data = await request.json()
    filename = data.get("filename", "")
    target_dir = data.get("target_dir", "checkpoints")
    total_size = data.get("total_size", 0)
    total_chunks = data.get("total_chunks", 0)

    if not filename:
        return web.json_response({"error": "filename required"}, status=400)
    if target_dir not in MODEL_DIRS:
        return web.json_response({"error": f"invalid target_dir: {target_dir}"}, status=400)

    session_id = str(uuid.uuid4())
    session_dir = os.path.join(TEMP_PATH, session_id)
    os.makedirs(session_dir, exist_ok=True)

    upload_sessions[session_id] = {
        "filename": filename,
        "target_dir": target_dir,
        "total_size": total_size,
        "total_chunks": total_chunks,
        "received_chunks": 0,
        "session_dir": session_dir,
    }

    return web.json_response({"session_id": session_id})


@server.PromptServer.instance.routes.post("/api/model-upload/chunk")
async def upload_chunk(request):
    """Receive a single chunk."""
    reader = await request.multipart()

    session_id = None
    chunk_index = None
    chunk_data = None

    async for part in reader:
        if part.name == "session_id":
            session_id = (await part.read()).decode()
        elif part.name == "chunk_index":
            chunk_index = int((await part.read()).decode())
        elif part.name == "chunk":
            chunk_data = await part.read()

    if not session_id or session_id not in upload_sessions:
        return web.json_response({"error": "invalid session_id"}, status=400)
    if chunk_index is None or chunk_data is None:
        return web.json_response({"error": "chunk_index and chunk required"}, status=400)

    session = upload_sessions[session_id]
    chunk_path = os.path.join(session["session_dir"], f"chunk_{chunk_index:06d}")

    with open(chunk_path, "wb") as f:
        f.write(chunk_data)

    session["received_chunks"] += 1

    return web.json_response({
        "received": session["received_chunks"],
        "total": session["total_chunks"],
    })


@server.PromptServer.instance.routes.post("/api/model-upload/complete")
async def upload_complete(request):
    """Merge chunks and move to target directory."""
    data = await request.json()
    session_id = data.get("session_id", "")

    if not session_id or session_id not in upload_sessions:
        return web.json_response({"error": "invalid session_id"}, status=400)

    session = upload_sessions[session_id]

    if session["received_chunks"] < session["total_chunks"]:
        return web.json_response({
            "error": f"missing chunks: {session['received_chunks']}/{session['total_chunks']}"
        }, status=400)

    target_path = os.path.join(MODEL_DIRS[session["target_dir"]], session["filename"])
    os.makedirs(os.path.dirname(target_path), exist_ok=True)

    # Merge chunks into final file
    try:
        with open(target_path, "wb") as out:
            for i in range(session["total_chunks"]):
                chunk_path = os.path.join(session["session_dir"], f"chunk_{i:06d}")
                with open(chunk_path, "rb") as chunk_file:
                    shutil.copyfileobj(chunk_file, out)
    except Exception as e:
        return web.json_response({"error": str(e)}, status=500)
    finally:
        # Cleanup temp chunks
        shutil.rmtree(session["session_dir"], ignore_errors=True)
        del upload_sessions[session_id]

    return web.json_response({
        "status": "complete",
        "path": target_path,
        "size": os.path.getsize(target_path),
    })


@server.PromptServer.instance.routes.post("/api/model-upload/cancel")
async def upload_cancel(request):
    """Cancel an upload session and cleanup."""
    data = await request.json()
    session_id = data.get("session_id", "")

    if session_id and session_id in upload_sessions:
        session = upload_sessions[session_id]
        shutil.rmtree(session["session_dir"], ignore_errors=True)
        del upload_sessions[session_id]

    return web.json_response({"status": "cancelled"})


@server.PromptServer.instance.routes.get("/api/model-upload/status/{session_id}")
async def upload_status(request):
    """Get upload session status."""
    session_id = request.match_info["session_id"]
    if session_id not in upload_sessions:
        return web.json_response({"error": "session not found"}, status=404)

    session = upload_sessions[session_id]
    return web.json_response({
        "filename": session["filename"],
        "target_dir": session["target_dir"],
        "received_chunks": session["received_chunks"],
        "total_chunks": session["total_chunks"],
        "total_size": session["total_size"],
    })


NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
