#!/bin/bash
# ComfyUI Environment Switcher
# This script is run at container startup to configure the active environment

set -e

# Configuration
EFS_MOUNT_PATH="${EFS_MOUNT_PATH:-/mnt/efs}"
COMFYUI_PATH="${COMFYUI_PATH:-/home/user/opt/ComfyUI}"
CONFIG_PATH="${EFS_MOUNT_PATH}/config.json"
ENVIRONMENTS_PATH="${EFS_MOUNT_PATH}/environments"
SHARED_MODELS_PATH="${EFS_MOUNT_PATH}/shared/models"

# Colors for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get current environment from config or SSM
get_current_environment() {
    local env_name="default"

    # Try to get from SSM first (allows dynamic switching)
    if command -v aws &> /dev/null; then
        env_name=$(aws ssm get-parameter --name "/comfyui/current-environment" --query "Parameter.Value" --output text 2>/dev/null || echo "")
    fi

    # Fallback to config file
    if [ -z "$env_name" ] || [ "$env_name" == "None" ]; then
        if [ -f "$CONFIG_PATH" ]; then
            env_name=$(python3 -c "import json; print(json.load(open('$CONFIG_PATH')).get('current_environment', 'default'))" 2>/dev/null || echo "default")
        fi
    fi

    echo "$env_name"
}

# Initialize shared models directory structure
init_shared_models() {
    log_info "Initializing shared models directory..."

    local model_dirs=(
        "checkpoints"
        "clip"
        "clip_vision"
        "configs"
        "controlnet"
        "embeddings"
        "loras"
        "upscale_models"
        "vae"
        "unet"
        "diffusion_models"
    )

    for dir in "${model_dirs[@]}"; do
        mkdir -p "${SHARED_MODELS_PATH}/${dir}"
    done

    log_info "Shared models directory initialized at ${SHARED_MODELS_PATH}"
}

# Initialize default environment if not exists
init_default_environment() {
    local default_env_path="${ENVIRONMENTS_PATH}/default"

    if [ ! -d "$default_env_path" ]; then
        log_info "Creating default environment..."
        mkdir -p "${default_env_path}/custom_nodes"
        mkdir -p "${default_env_path}/user"
        mkdir -p "${default_env_path}/output"

        # Create extra_model_paths.yaml
        cat > "${default_env_path}/extra_model_paths.yaml" << EOF
# Auto-generated for environment: default
comfyui_shared:
    base_path: ${SHARED_MODELS_PATH}
    checkpoints: checkpoints/
    clip: clip/
    clip_vision: clip_vision/
    configs: configs/
    controlnet: controlnet/
    embeddings: embeddings/
    loras: loras/
    upscale_models: upscale_models/
    vae: vae/
    unet: unet/
    diffusion_models: diffusion_models/
EOF

        log_info "Default environment created at ${default_env_path}"
    fi

    # Initialize config file if not exists
    if [ ! -f "$CONFIG_PATH" ]; then
        log_info "Creating initial config..."
        cat > "$CONFIG_PATH" << EOF
{
    "current_environment": "default",
    "environments": {
        "default": {
            "name": "default",
            "description": "Default ComfyUI environment",
            "created_at": "$(date -Iseconds)",
            "custom_nodes": [],
            "python_version": "3.12"
        }
    }
}
EOF
    fi
}

# Configure environment for ComfyUI
configure_environment() {
    local env_name="$1"
    local env_path="${ENVIRONMENTS_PATH}/${env_name}"

    log_info "Configuring environment: ${env_name}"

    # Check if environment exists
    if [ ! -d "$env_path" ]; then
        log_warn "Environment '${env_name}' not found, falling back to default"
        env_name="default"
        env_path="${ENVIRONMENTS_PATH}/default"
    fi

    # Link custom_nodes from environment to ComfyUI
    if [ -d "${env_path}/custom_nodes" ]; then
        # Copy environment-specific custom nodes
        log_info "Setting up custom nodes from environment..."

        # First, ensure ComfyUI-Manager is always present
        if [ ! -d "${COMFYUI_PATH}/custom_nodes/ComfyUI-Manager" ]; then
            git clone --depth 1 https://github.com/ltdrdata/ComfyUI-Manager "${COMFYUI_PATH}/custom_nodes/ComfyUI-Manager" 2>/dev/null || true
        fi

        # Link environment-specific custom nodes
        for node_dir in "${env_path}/custom_nodes"/*; do
            if [ -d "$node_dir" ]; then
                node_name=$(basename "$node_dir")
                target="${COMFYUI_PATH}/custom_nodes/${node_name}"

                if [ ! -e "$target" ]; then
                    ln -sf "$node_dir" "$target"
                    log_info "Linked custom node: ${node_name}"
                fi
            fi
        done
    fi

    # Copy extra_model_paths.yaml (remove first to handle root-owned files from previous deploys)
    if [ -f "${env_path}/extra_model_paths.yaml" ]; then
        rm -f "${COMFYUI_PATH}/extra_model_paths.yaml" 2>/dev/null || true
        cp "${env_path}/extra_model_paths.yaml" "${COMFYUI_PATH}/extra_model_paths.yaml"
        log_info "Applied extra_model_paths.yaml from environment"
    fi

    # Set output directory to environment-specific path
    export COMFYUI_OUTPUT_DIR="${env_path}/output"
    mkdir -p "$COMFYUI_OUTPUT_DIR"

    # Set user directory for environment-specific settings
    export COMFYUI_USER_DIR="${env_path}/user"
    mkdir -p "$COMFYUI_USER_DIR"

    log_info "Environment '${env_name}' configured successfully"
}

# Main execution
main() {
    log_info "ComfyUI Environment Switcher starting..."

    # Check if EFS is mounted
    if [ ! -d "$EFS_MOUNT_PATH" ]; then
        log_warn "EFS not mounted at ${EFS_MOUNT_PATH}, using local storage"
        mkdir -p "$EFS_MOUNT_PATH"
    fi

    # Initialize directories
    mkdir -p "$ENVIRONMENTS_PATH"

    # Initialize shared models
    init_shared_models

    # Initialize default environment
    init_default_environment

    # Get current environment
    CURRENT_ENV=$(get_current_environment)
    log_info "Current environment: ${CURRENT_ENV}"

    # Configure the environment
    configure_environment "$CURRENT_ENV"

    log_info "Environment setup complete!"
}

# Run main function
main "$@"
