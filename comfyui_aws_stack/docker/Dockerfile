FROM nvidia/cuda:12.9.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    TZ=America/Los_Angeles

# Install dependencies
RUN apt-get update && apt-get install -y \
    git \
    make build-essential libssl-dev zlib1g-dev \
    libbz2-dev libreadline-dev libsqlite3-dev wget curl llvm \
    libncursesw5-dev xz-utils tk-dev libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev git git-lfs  \
    ffmpeg libsm6 libxext6 cmake libgl1-mesa-glx \
    nfs-common \
    && rm -rf /var/lib/apt/lists/* \
    && git lfs install

# Create user
RUN useradd -m -u 1000 user

# Create mount points with user ownership BEFORE switching to user
RUN mkdir -p /mnt/efs && chown user:user /mnt/efs
RUN mkdir -p /home/user/opt/ComfyUI && chown user:user /home/user/opt/ComfyUI
RUN mkdir -p /home/user/scripts && chown user:user /home/user/scripts

USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

# Pyenv and Python setup
RUN curl https://pyenv.run | bash
ENV PATH=$HOME/.pyenv/shims:$HOME/.pyenv/bin:$PATH
ENV PYTHON_VERSION=3.12.0
RUN pyenv install $PYTHON_VERSION && \
    pyenv global $PYTHON_VERSION && \
    pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir torch torchvision torchaudio --extra-index-url https://download.pytorch.org/whl/cu126

# Install boto3 for AWS integration
RUN pip install --no-cache-dir boto3

# Set the working directory
WORKDIR /home/user/opt/ComfyUI

# Clone ComfyUI and ComfyUI-Manager
RUN git clone --depth 1 https://github.com/comfyanonymous/ComfyUI . && \
    mkdir -p custom_nodes/ComfyUI-Manager && \
    git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager custom_nodes/ComfyUI-Manager

# Install requirements from cloned repositories
RUN pip install --no-cache-dir -r requirements.txt && \
    pip install --no-cache-dir -r custom_nodes/ComfyUI-Manager/requirements.txt

# Copy environment management scripts
COPY --chown=user:user scripts/switch_environment.sh /home/user/scripts/
COPY --chown=user:user scripts/entrypoint.sh /home/user/scripts/
RUN chmod +x /home/user/scripts/*.sh

# Cache busting for Environment Manager (change this value to force rebuild)
ARG CACHE_BUST=20260310_v1

# Copy Environment Manager custom node
COPY --chown=user:user custom_nodes/ComfyUI-Environment-Manager /home/user/opt/ComfyUI/custom_nodes/ComfyUI-Environment-Manager

# Copy Model Uploader custom node (chunked upload for large model files)
COPY --chown=user:user custom_nodes/ComfyUI-Model-Uploader /home/user/opt/ComfyUI/custom_nodes/ComfyUI-Model-Uploader
RUN mkdir -p /home/user/opt/ComfyUI/temp_uploads

# ============================================
# Advanced Workshop: Pre-install custom nodes
# ============================================

# 1. ComfyUI-Yedp-Action-Director (3D animation -> ControlNet passes)
RUN git clone --depth 1 https://github.com/yedp123/ComfyUI-Yedp-Action-Director custom_nodes/ComfyUI-Yedp-Action-Director && \
    mkdir -p input/yedp_anims

# 2. comfyui-GaussianViewer (3DGS viewer for ComfyUI)
RUN git clone --depth 1 https://github.com/CarlMarkswx/comfyui-GaussianViewer custom_nodes/comfyui-GaussianViewer

# 3. ComfyUI-Qwen-TTS (voice synthesis & cloning)
RUN git clone --depth 1 https://github.com/flybirdxx/ComfyUI-Qwen-TTS custom_nodes/ComfyUI-QwenTTS && \
    pip install --no-cache-dir -r custom_nodes/ComfyUI-QwenTTS/requirements.txt && \
    pip install --no-cache-dir "transformers==4.57.3"

# ComfyUI Manager: copy full config.ini with security_level = weak
RUN mkdir -p user/default/ComfyUI-Manager
COPY --chown=user:user comfyui_config/config.ini user/default/ComfyUI-Manager/config.ini

# Copy the default configuration file
COPY --chown=user:user comfyui_config/extra_model_paths.yaml ./extra_model_paths.yaml

# Snapshot the fully built ComfyUI for EBS volume initialization
RUN cp -a /home/user/opt/ComfyUI /home/user/opt/ComfyUI_snapshot

# Environment variables for environment management
ENV EFS_MOUNT_PATH=/mnt/efs \
    COMFYUI_PATH=/home/user/opt/ComfyUI \
    COMFYUI_SNAPSHOT=/home/user/opt/ComfyUI_snapshot \
    SCRIPTS_PATH=/home/user/scripts

# Use entrypoint script for environment initialization
ENTRYPOINT ["/home/user/scripts/entrypoint.sh"]
