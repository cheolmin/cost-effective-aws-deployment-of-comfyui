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

# Copy ComfyUI Manager config (security_level=weak) if not already present
MANAGER_CONFIG_DIR="${USER_DIR}/default/ComfyUI-Manager"
if [ ! -f "${MANAGER_CONFIG_DIR}/config.ini" ]; then
    echo "Initializing ComfyUI Manager config (security_level=weak)..."
    mkdir -p "${MANAGER_CONFIG_DIR}"
    cp "${COMFYUI_PATH}/user/default/ComfyUI-Manager/config.ini" "${MANAGER_CONFIG_DIR}/config.ini" 2>/dev/null || \
    printf '[default]\nsecurity_level = weak\n' > "${MANAGER_CONFIG_DIR}/config.ini"
fi

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
