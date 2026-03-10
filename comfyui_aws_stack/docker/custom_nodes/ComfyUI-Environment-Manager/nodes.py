"""
ComfyUI Environment Manager Nodes
Provides nodes for environment management operations.
"""

import os
import json
import subprocess
from datetime import datetime

# Configuration paths
EFS_MOUNT_PATH = os.environ.get("EFS_MOUNT_PATH", "/mnt/efs")
CONFIG_PATH = f"{EFS_MOUNT_PATH}/config.json"
ENVIRONMENTS_PATH = f"{EFS_MOUNT_PATH}/environments"
SHARED_MODELS_PATH = f"{EFS_MOUNT_PATH}/shared/models"


def get_config():
    """Load environment configuration."""
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"[EnvManager] Error loading config: {e}")

    return {
        "current_environment": "default",
        "environments": {
            "default": {
                "name": "default",
                "description": "Default environment",
                "created_at": datetime.now().isoformat()
            }
        }
    }


def save_config(config):
    """Save environment configuration."""
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"[EnvManager] Error saving config: {e}")
        return False


def get_environment_list():
    """Get list of available environments."""
    config = get_config()
    return list(config.get("environments", {}).keys())


class EnvironmentInfo:
    """Node to display current environment information."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING",)
    RETURN_NAMES = ("current_env", "env_list", "env_details",)
    FUNCTION = "get_info"
    CATEGORY = "Environment Manager"
    OUTPUT_NODE = True

    def get_info(self):
        config = get_config()
        current_env = config.get("current_environment", "default")
        env_list = ", ".join(config.get("environments", {}).keys())

        # Get details of current environment
        env_data = config.get("environments", {}).get(current_env, {})
        env_details = json.dumps(env_data, indent=2)

        return (current_env, env_list, env_details,)


class EnvironmentSelector:
    """Node to select and view environments."""

    @classmethod
    def INPUT_TYPES(cls):
        environments = get_environment_list()
        if not environments:
            environments = ["default"]

        return {
            "required": {
                "environment": (environments, {"default": environments[0]}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING",)
    RETURN_NAMES = ("selected_env", "env_path",)
    FUNCTION = "select_environment"
    CATEGORY = "Environment Manager"

    def select_environment(self, environment):
        env_path = f"{ENVIRONMENTS_PATH}/{environment}"
        return (environment, env_path,)


class EnvironmentCreator:
    """Node to create a new environment."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "name": ("STRING", {"default": "new_environment"}),
                "description": ("STRING", {"default": "My custom environment", "multiline": True}),
            },
            "optional": {
                "base_environment": (get_environment_list() or ["default"],),
            }
        }

    RETURN_TYPES = ("STRING", "BOOLEAN",)
    RETURN_NAMES = ("result", "success",)
    FUNCTION = "create_environment"
    CATEGORY = "Environment Manager"
    OUTPUT_NODE = True

    def create_environment(self, name, description, base_environment="default"):
        try:
            # Validate name
            name = name.strip().replace(" ", "_")
            if not name:
                return ("Error: Name is required", False,)

            config = get_config()

            if name in config.get("environments", {}):
                return (f"Error: Environment '{name}' already exists", False,)

            # Create directory structure
            env_path = f"{ENVIRONMENTS_PATH}/{name}"
            os.makedirs(f"{env_path}/custom_nodes", exist_ok=True)
            os.makedirs(f"{env_path}/user", exist_ok=True)
            os.makedirs(f"{env_path}/output", exist_ok=True)

            # Create extra_model_paths.yaml
            extra_model_paths = f"""# Environment: {name}
comfyui_shared:
    base_path: {SHARED_MODELS_PATH}
    checkpoints: checkpoints/
    clip: clip/
    clip_vision: clip_vision/
    configs: configs/
    controlnet: controlnet/
    embeddings: embeddings/
    loras: loras/
    upscale_models: upscale_models/
    vae: vae/
"""
            with open(f"{env_path}/extra_model_paths.yaml", 'w') as f:
                f.write(extra_model_paths)

            # Update config
            config.setdefault("environments", {})[name] = {
                "name": name,
                "description": description,
                "created_at": datetime.now().isoformat(),
                "base_environment": base_environment
            }
            save_config(config)

            return (f"Environment '{name}' created successfully at {env_path}", True,)

        except Exception as e:
            return (f"Error: {str(e)}", False,)


class EnvironmentSwitcher:
    """Node to switch between environments (requires restart)."""

    @classmethod
    def INPUT_TYPES(cls):
        environments = get_environment_list()
        if not environments:
            environments = ["default"]

        return {
            "required": {
                "target_environment": (environments,),
                "confirm_switch": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING", "BOOLEAN",)
    RETURN_NAMES = ("message", "needs_restart",)
    FUNCTION = "switch_environment"
    CATEGORY = "Environment Manager"
    OUTPUT_NODE = True

    def switch_environment(self, target_environment, confirm_switch):
        if not confirm_switch:
            return ("Set 'confirm_switch' to True to switch environment. ComfyUI will need to restart.", False,)

        try:
            config = get_config()
            current = config.get("current_environment", "default")

            if target_environment == current:
                return (f"Already in environment '{target_environment}'", False,)

            if target_environment not in config.get("environments", {}):
                return (f"Environment '{target_environment}' not found", False,)

            # Update config
            config["current_environment"] = target_environment
            save_config(config)

            # Try to update SSM parameter for Lambda integration
            try:
                import boto3
                ssm = boto3.client('ssm')
                ssm.put_parameter(
                    Name='/comfyui/current-environment',
                    Value=target_environment,
                    Type='String',
                    Overwrite=True
                )
            except:
                pass  # SSM update is optional

            return (f"Switched to '{target_environment}'. Please restart ComfyUI to apply changes.", True,)

        except Exception as e:
            return (f"Error: {str(e)}", False,)


class EnvironmentCustomNodeInstaller:
    """Node to install custom nodes into specific environment."""

    @classmethod
    def INPUT_TYPES(cls):
        environments = get_environment_list()
        if not environments:
            environments = ["default"]

        return {
            "required": {
                "environment": (environments,),
                "git_url": ("STRING", {"default": "https://github.com/user/repo.git"}),
                "install": ("BOOLEAN", {"default": False}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("result",)
    FUNCTION = "install_custom_node"
    CATEGORY = "Environment Manager"
    OUTPUT_NODE = True

    def install_custom_node(self, environment, git_url, install):
        if not install:
            return (f"Set 'install' to True to clone {git_url} into {environment}",)

        try:
            env_path = f"{ENVIRONMENTS_PATH}/{environment}/custom_nodes"
            os.makedirs(env_path, exist_ok=True)

            # Extract repo name from URL
            repo_name = git_url.rstrip('/').split('/')[-1].replace('.git', '')
            target_path = f"{env_path}/{repo_name}"

            if os.path.exists(target_path):
                return (f"Custom node '{repo_name}' already exists in {environment}",)

            # Clone repository
            result = subprocess.run(
                ["git", "clone", "--depth", "1", git_url, target_path],
                capture_output=True,
                text=True
            )

            if result.returncode == 0:
                # Install requirements if exists
                req_file = f"{target_path}/requirements.txt"
                if os.path.exists(req_file):
                    subprocess.run(["pip", "install", "-r", req_file], capture_output=True)

                return (f"Successfully installed '{repo_name}' to {environment}. Restart ComfyUI to load.",)
            else:
                return (f"Error cloning: {result.stderr}",)

        except Exception as e:
            return (f"Error: {str(e)}",)


class SharedModelPath:
    """Node to output the shared models path for use in other nodes."""

    @classmethod
    def INPUT_TYPES(cls):
        model_types = [
            "checkpoints",
            "loras",
            "vae",
            "controlnet",
            "embeddings",
            "clip",
            "upscale_models",
            "unet",
            "diffusion_models"
        ]

        return {
            "required": {
                "model_type": (model_types,),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("path",)
    FUNCTION = "get_path"
    CATEGORY = "Environment Manager"

    def get_path(self, model_type):
        path = f"{SHARED_MODELS_PATH}/{model_type}"
        os.makedirs(path, exist_ok=True)
        return (path,)


# Node mappings for ComfyUI
NODE_CLASS_MAPPINGS = {
    "EnvironmentInfo": EnvironmentInfo,
    "EnvironmentSelector": EnvironmentSelector,
    "EnvironmentCreator": EnvironmentCreator,
    "EnvironmentSwitcher": EnvironmentSwitcher,
    "EnvironmentCustomNodeInstaller": EnvironmentCustomNodeInstaller,
    "SharedModelPath": SharedModelPath,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EnvironmentInfo": "🌍 Environment Info",
    "EnvironmentSelector": "🔍 Select Environment",
    "EnvironmentCreator": "➕ Create Environment",
    "EnvironmentSwitcher": "🔄 Switch Environment",
    "EnvironmentCustomNodeInstaller": "📦 Install Custom Node",
    "SharedModelPath": "📁 Shared Model Path",
}
