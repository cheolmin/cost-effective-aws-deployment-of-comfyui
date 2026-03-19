#!/bin/bash
# ComfyUI Entrypoint with Environment Management
# This script initializes the environment and starts ComfyUI

set -e

# Configuration
EFS_MOUNT_PATH="${EFS_MOUNT_PATH:-/mnt/efs}"
COMFYUI_PATH="${COMFYUI_PATH:-/home/user/opt/ComfyUI}"
SCRIPTS_PATH="${SCRIPTS_PATH:-/home/user/scripts}"

echo "============================================"
echo "ComfyUI Container Starting"
echo "============================================"
echo "EFS Mount Path: ${EFS_MOUNT_PATH}"
echo "ComfyUI Path: ${COMFYUI_PATH}"
echo "============================================"

# Initialize EBS volume from Docker image snapshot if empty
COMFYUI_SNAPSHOT="${COMFYUI_SNAPSHOT:-/home/user/comfyui_snapshot}"
if [ -d "${COMFYUI_SNAPSHOT}" ]; then
    if [ ! -f "${COMFYUI_PATH}/main.py" ]; then
        echo "EBS volume is empty. Initializing from Docker image snapshot..."
        cp -a "${COMFYUI_SNAPSHOT}/." "${COMFYUI_PATH}/"
        echo "EBS volume initialized successfully."
    else
        # Sync custom_nodes that exist in snapshot but not in EBS
        echo "Syncing pre-installed custom nodes from snapshot..."
        for node_dir in "${COMFYUI_SNAPSHOT}/custom_nodes"/*/; do
            node_name=$(basename "$node_dir")
            if [ ! -d "${COMFYUI_PATH}/custom_nodes/${node_name}" ]; then
                echo "  Installing: ${node_name}"
                cp -a "$node_dir" "${COMFYUI_PATH}/custom_nodes/${node_name}"
            fi
        done
        # Ensure input/yedp_anims exists
        mkdir -p "${COMFYUI_PATH}/input/yedp_anims"
        # Ensure temp_uploads exists
        mkdir -p "${COMFYUI_PATH}/temp_uploads"
        # Always sync config.ini (enforce security_level=weak)
        if [ -f "${COMFYUI_SNAPSHOT}/user/default/ComfyUI-Manager/config.ini" ]; then
            mkdir -p "${COMFYUI_PATH}/user/default/ComfyUI-Manager"
            cp "${COMFYUI_SNAPSHOT}/user/default/ComfyUI-Manager/config.ini" \
               "${COMFYUI_PATH}/user/default/ComfyUI-Manager/config.ini"
            echo "  Copied ComfyUI Manager config.ini"
        fi
        echo "Sync complete."
    fi
fi

# Wait for EFS mount if necessary
MAX_WAIT=30
WAIT_COUNT=0
while [ ! -d "${EFS_MOUNT_PATH}" ] && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    echo "Waiting for EFS mount... (${WAIT_COUNT}/${MAX_WAIT})"
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

# Run environment setup script
if [ -f "${SCRIPTS_PATH}/switch_environment.sh" ]; then
    echo "Running environment setup..."
    source "${SCRIPTS_PATH}/switch_environment.sh"
else
    echo "Warning: Environment setup script not found"
fi

# Move to ComfyUI directory
cd "${COMFYUI_PATH}"

# Get output directory from environment or use default
OUTPUT_DIR="${COMFYUI_OUTPUT_DIR:-${COMFYUI_PATH}/output}"
USER_DIR="${COMFYUI_USER_DIR:-${EFS_MOUNT_PATH}/environments/default/user}"

# Ensure directories exist
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${USER_DIR}"

# Always enforce ComfyUI Manager config (security_level=weak)
# Manager may overwrite config.ini with defaults on startup, so force it every time
MANAGER_CONFIG_DIR="${USER_DIR}/default/ComfyUI-Manager"
mkdir -p "${MANAGER_CONFIG_DIR}"
echo "Enforcing ComfyUI Manager config (security_level=weak)..."
cp "${COMFYUI_PATH}/user/default/ComfyUI-Manager/config.ini" "${MANAGER_CONFIG_DIR}/config.ini" 2>/dev/null || \
printf '[default]\nsecurity_level = weak\n' > "${MANAGER_CONFIG_DIR}/config.ini"

# Build command arguments - always include user directory
COMFYUI_ARGS="--listen 0.0.0.0 --port 8181 --output-directory ${OUTPUT_DIR} --user-directory ${USER_DIR}"

# Add extra model paths if exists
if [ -f "${COMFYUI_PATH}/extra_model_paths.yaml" ]; then
    COMFYUI_ARGS="${COMFYUI_ARGS} --extra-model-paths-config ${COMFYUI_PATH}/extra_model_paths.yaml"
fi

# Add any additional arguments passed to the container
if [ $# -gt 0 ]; then
    COMFYUI_ARGS="${COMFYUI_ARGS} $@"
fi

echo "============================================"
echo "Starting ComfyUI with arguments:"
echo "${COMFYUI_ARGS}"
echo "============================================"

# Start ComfyUI
exec python "${COMFYUI_PATH}/main.py" ${COMFYUI_ARGS}
