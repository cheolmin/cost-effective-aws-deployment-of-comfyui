"""
ComfyUI Environment Manager Lambda
Provides APIs for managing ComfyUI environments (list, create, switch, delete)
"""
import boto3
import json
import os
from datetime import datetime

# Environment variables
EFS_MOUNT_PATH = os.environ.get("EFS_MOUNT_PATH", "/mnt/efs")
ECS_CLUSTER_NAME = os.environ.get("ECS_CLUSTER_NAME", "")
ECS_SERVICE_NAME = os.environ.get("ECS_SERVICE_NAME", "")
ASG_NAME = os.environ.get("ASG_NAME", "")

# Paths
ENVIRONMENTS_PATH = f"{EFS_MOUNT_PATH}/environments"
CONFIG_PATH = f"{EFS_MOUNT_PATH}/config.json"
SHARED_MODELS_PATH = f"{EFS_MOUNT_PATH}/shared/models"

# Clients
ecs_client = boto3.client('ecs')
ssm_client = boto3.client('ssm')


def get_config():
    """Load environment configuration from EFS."""
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r') as f:
                return json.load(f)
    except Exception as e:
        print(f"Error loading config: {e}")

    return {
        "current_environment": "default",
        "environments": {
            "default": {
                "name": "default",
                "description": "Default ComfyUI environment",
                "created_at": datetime.now().isoformat(),
                "custom_nodes": [],
                "python_version": "3.12"
            }
        }
    }


def save_config(config):
    """Save environment configuration to EFS."""
    try:
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        with open(CONFIG_PATH, 'w') as f:
            json.dump(config, f, indent=2)
        return True
    except Exception as e:
        print(f"Error saving config: {e}")
        return False


def list_environments(event):
    """List all available environments."""
    config = get_config()
    environments = []

    for env_name, env_data in config.get("environments", {}).items():
        environments.append({
            "name": env_name,
            "description": env_data.get("description", ""),
            "created_at": env_data.get("created_at", ""),
            "is_current": env_name == config.get("current_environment"),
            "custom_nodes_count": len(env_data.get("custom_nodes", []))
        })

    return {
        "statusCode": 200,
        "body": json.dumps({
            "current_environment": config.get("current_environment"),
            "environments": environments
        }),
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    }


def create_environment(event):
    """Create a new environment."""
    try:
        body = json.loads(event.get("body", "{}"))
        env_name = body.get("name", "").strip()
        description = body.get("description", "")
        base_env = body.get("base_environment", "default")

        if not env_name:
            return error_response(400, "Environment name is required")

        if not env_name.isalnum() and "-" not in env_name and "_" not in env_name:
            return error_response(400, "Environment name must be alphanumeric (hyphens and underscores allowed)")

        config = get_config()

        if env_name in config.get("environments", {}):
            return error_response(409, f"Environment '{env_name}' already exists")

        # Create environment directory structure
        env_path = f"{ENVIRONMENTS_PATH}/{env_name}"
        os.makedirs(f"{env_path}/custom_nodes", exist_ok=True)
        os.makedirs(f"{env_path}/user", exist_ok=True)
        os.makedirs(f"{env_path}/output", exist_ok=True)

        # Create extra_model_paths.yaml for shared models
        extra_model_paths = f"""
# Auto-generated for environment: {env_name}
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

        # Add to config
        config.setdefault("environments", {})[env_name] = {
            "name": env_name,
            "description": description,
            "created_at": datetime.now().isoformat(),
            "custom_nodes": [],
            "python_version": "3.12",
            "base_environment": base_env
        }

        save_config(config)

        return {
            "statusCode": 201,
            "body": json.dumps({
                "message": f"Environment '{env_name}' created successfully",
                "environment": config["environments"][env_name]
            }),
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        }
    except Exception as e:
        return error_response(500, str(e))


def switch_environment(event):
    """Switch to a different environment (requires ECS task restart)."""
    try:
        body = json.loads(event.get("body", "{}"))
        env_name = body.get("name", "").strip()

        if not env_name:
            return error_response(400, "Environment name is required")

        config = get_config()

        if env_name not in config.get("environments", {}):
            return error_response(404, f"Environment '{env_name}' not found")

        # Update current environment
        config["current_environment"] = env_name
        save_config(config)

        # Update SSM Parameter for container to read on startup
        try:
            ssm_client.put_parameter(
                Name='/comfyui/current-environment',
                Value=env_name,
                Type='String',
                Overwrite=True
            )
        except Exception as e:
            print(f"Warning: Could not update SSM parameter: {e}")

        # Restart ECS service to apply new environment
        restart_message = ""
        if ECS_CLUSTER_NAME and ECS_SERVICE_NAME:
            try:
                ecs_client.update_service(
                    cluster=ECS_CLUSTER_NAME,
                    service=ECS_SERVICE_NAME,
                    forceNewDeployment=True
                )
                restart_message = "ECS service is restarting with the new environment."
            except Exception as e:
                restart_message = f"Warning: Could not restart ECS service: {e}"

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": f"Switched to environment '{env_name}'",
                "restart_status": restart_message,
                "current_environment": env_name
            }),
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        }
    except Exception as e:
        return error_response(500, str(e))


def delete_environment(event):
    """Delete an environment."""
    try:
        body = json.loads(event.get("body", "{}"))
        env_name = body.get("name", "").strip()

        if not env_name:
            return error_response(400, "Environment name is required")

        if env_name == "default":
            return error_response(403, "Cannot delete the default environment")

        config = get_config()

        if env_name not in config.get("environments", {}):
            return error_response(404, f"Environment '{env_name}' not found")

        if config.get("current_environment") == env_name:
            return error_response(409, "Cannot delete the currently active environment. Switch to another environment first.")

        # Remove from config (keep files for safety, just remove from tracking)
        del config["environments"][env_name]
        save_config(config)

        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": f"Environment '{env_name}' deleted from configuration",
                "note": "Environment files are preserved on EFS for safety"
            }),
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        }
    except Exception as e:
        return error_response(500, str(e))


def get_environment_details(event):
    """Get detailed information about a specific environment."""
    try:
        # Get environment name from path parameters or query string
        path_params = event.get("pathParameters", {}) or {}
        query_params = event.get("queryStringParameters", {}) or {}
        env_name = path_params.get("name") or query_params.get("name", "")

        if not env_name:
            return error_response(400, "Environment name is required")

        config = get_config()

        if env_name not in config.get("environments", {}):
            return error_response(404, f"Environment '{env_name}' not found")

        env_data = config["environments"][env_name]
        env_path = f"{ENVIRONMENTS_PATH}/{env_name}"

        # Get custom nodes list from directory
        custom_nodes = []
        custom_nodes_path = f"{env_path}/custom_nodes"
        if os.path.exists(custom_nodes_path):
            custom_nodes = [d for d in os.listdir(custom_nodes_path)
                          if os.path.isdir(f"{custom_nodes_path}/{d}")]

        return {
            "statusCode": 200,
            "body": json.dumps({
                "environment": {
                    **env_data,
                    "is_current": env_name == config.get("current_environment"),
                    "custom_nodes": custom_nodes,
                    "path": env_path
                }
            }),
            "headers": {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*"
            }
        }
    except Exception as e:
        return error_response(500, str(e))


def error_response(status_code, message):
    """Generate error response."""
    return {
        "statusCode": status_code,
        "body": json.dumps({"error": message}),
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        }
    }


def handler(event, context):
    """Main Lambda handler - routes requests to appropriate functions."""
    http_method = event.get("httpMethod", event.get("requestContext", {}).get("http", {}).get("method", ""))
    path = event.get("path", event.get("rawPath", ""))

    print(f"Request: {http_method} {path}")
    print(f"Event: {json.dumps(event)}")

    # Route based on method and path
    if path.endswith("/environments") or path.endswith("/environments/"):
        if http_method == "GET":
            return list_environments(event)
        elif http_method == "POST":
            return create_environment(event)

    elif "/environments/switch" in path:
        if http_method == "PUT" or http_method == "POST":
            return switch_environment(event)

    elif "/environments/" in path and http_method == "DELETE":
        return delete_environment(event)

    elif "/environments/" in path and http_method == "GET":
        return get_environment_details(event)

    # Handle OPTIONS for CORS
    elif http_method == "OPTIONS":
        return {
            "statusCode": 200,
            "headers": {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization"
            },
            "body": ""
        }

    return error_response(404, f"Not found: {http_method} {path}")
