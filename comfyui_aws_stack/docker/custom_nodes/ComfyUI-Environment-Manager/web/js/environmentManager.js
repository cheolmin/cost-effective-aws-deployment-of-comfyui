/**
 * ComfyUI Environment Manager - Web UI Extension
 * Adds environment management menu to ComfyUI interface
 */

import { app } from "/scripts/app.js";

// Environment Manager Class
class EnvironmentManager {
    constructor() {
        this.currentEnvironment = "default";
        this.environments = [];
        this.menuButton = null;
    }

    async loadEnvironments() {
        try {
            const response = await fetch('/api/environments');
            if (response.ok) {
                const data = await response.json();
                this.environments = data.environments || [];
                this.currentEnvironment = data.current_environment || "default";
            }
        } catch (e) {
            console.log("[EnvManager] Could not load environments from API, using defaults");
            this.environments = [{ name: "default", is_current: true }];
        }
    }

    createMenuButton() {
        const menu = document.querySelector(".comfy-menu");
        if (!menu) {
            setTimeout(() => this.createMenuButton(), 1000);
            return;
        }

        const envButton = document.createElement("button");
        envButton.id = "env-manager-button";
        envButton.textContent = "🌍 " + this.currentEnvironment;
        envButton.title = "Environment Manager";
        envButton.style.cssText = "background: #2a2a2a; border: 1px solid #444; color: #ddd; padding: 5px 10px; border-radius: 4px; cursor: pointer; margin: 2px;";

        const self = this;
        envButton.addEventListener("click", function() { self.showEnvironmentDialog(); });

        const firstChild = menu.firstChild;
        menu.insertBefore(envButton, firstChild);
        this.menuButton = envButton;

        console.log("[EnvManager] Menu button created");
    }

    showEnvironmentDialog() {
        const overlay = document.createElement("div");
        overlay.id = "env-manager-overlay";
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.7); display: flex; justify-content: center; align-items: center; z-index: 10000;";

        const dialog = document.createElement("div");
        dialog.style.cssText = "background: #1a1a1a; border: 1px solid #444; border-radius: 8px; padding: 20px; min-width: 400px; max-width: 600px; max-height: 80vh; overflow-y: auto; color: #ddd;";

        dialog.innerHTML = '<h2 style="margin-top: 0; border-bottom: 1px solid #444; padding-bottom: 10px;">Environment Manager</h2>' +
            '<div id="env-current" style="margin-bottom: 15px; padding: 10px; background: #2a2a2a; border-radius: 4px;"><strong>Current:</strong> <span id="current-env-name">' + this.currentEnvironment + '</span></div>' +
            '<div id="env-list" style="margin-bottom: 15px;"><h3>Available Environments</h3><div id="environments-container"></div></div>' +
            '<div id="env-create" style="border-top: 1px solid #444; padding-top: 15px;"><h3>Create New Environment</h3>' +
            '<input type="text" id="new-env-name" placeholder="Environment name" style="width: 100%; padding: 8px; margin-bottom: 10px; background: #2a2a2a; border: 1px solid #444; color: #ddd; border-radius: 4px;">' +
            '<textarea id="new-env-desc" placeholder="Description" style="width: 100%; padding: 8px; margin-bottom: 10px; background: #2a2a2a; border: 1px solid #444; color: #ddd; border-radius: 4px; resize: vertical;" rows="2"></textarea>' +
            '<button id="create-env-btn" style="background: #4a7; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Create Environment</button></div>' +
            '<div style="margin-top: 20px; text-align: right; border-top: 1px solid #444; padding-top: 15px;"><button id="close-env-dialog" style="background: #666; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Close</button></div>';

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        this.populateEnvironmentsList();

        const self = this;
        document.getElementById("close-env-dialog").addEventListener("click", function() { overlay.remove(); });
        overlay.addEventListener("click", function(e) { if (e.target === overlay) overlay.remove(); });
        document.getElementById("create-env-btn").addEventListener("click", function() { self.createNewEnvironment(); });
    }

    populateEnvironmentsList() {
        const container = document.getElementById("environments-container");
        if (!container) return;

        container.innerHTML = "";
        const self = this;

        for (let i = 0; i < this.environments.length; i++) {
            const env = this.environments[i];
            const envItem = document.createElement("div");
            const bgColor = env.is_current ? '#2a4a2a' : '#2a2a2a';
            const borderColor = env.is_current ? '#4a7' : '#444';
            envItem.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 10px; margin-bottom: 5px; background: " + bgColor + "; border: 1px solid " + borderColor + "; border-radius: 4px;";

            let itemHTML = '<div><strong>' + env.name + '</strong>';
            if (env.is_current) {
                itemHTML += '<span style="color: #4a7; margin-left: 10px;">Active</span>';
            }
            itemHTML += '<div style="font-size: 0.85em; color: #888;">' + (env.description || '') + '</div></div>';

            if (!env.is_current) {
                itemHTML += '<div><button class="switch-env-btn" data-env="' + env.name + '" style="background: #47a; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Switch</button></div>';
            } else {
                itemHTML += '<div></div>';
            }

            envItem.innerHTML = itemHTML;
            container.appendChild(envItem);
        }

        const switchBtns = container.querySelectorAll(".switch-env-btn");
        for (let i = 0; i < switchBtns.length; i++) {
            switchBtns[i].addEventListener("click", function(e) {
                const envName = e.target.getAttribute("data-env");
                self.switchEnvironment(envName);
            });
        }
    }

    async switchEnvironment(envName) {
        if (!confirm('Switch to environment "' + envName + '"?\n\nComfyUI will need to restart to apply changes.')) {
            return;
        }

        try {
            const response = await fetch('/api/environments/switch', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: envName })
            });

            if (response.ok) {
                alert('Switched to "' + envName + '". ComfyUI is restarting...');
                setTimeout(function() { window.location.reload(); }, 3000);
            } else {
                const error = await response.json();
                alert('Error: ' + (error.error || 'Failed to switch environment'));
            }
        } catch (e) {
            alert('Error switching environment: ' + e.message);
        }
    }

    async createNewEnvironment() {
        const nameInput = document.getElementById("new-env-name");
        const descInput = document.getElementById("new-env-desc");

        const name = nameInput.value.trim();
        const description = descInput.value.trim();

        if (!name) {
            alert("Please enter an environment name");
            return;
        }

        try {
            const response = await fetch('/api/environments', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name, description: description })
            });

            if (response.ok) {
                alert('Environment "' + name + '" created successfully!');
                await this.loadEnvironments();
                this.populateEnvironmentsList();
                nameInput.value = "";
                descInput.value = "";
            } else {
                const error = await response.json();
                alert('Error: ' + (error.error || 'Failed to create environment'));
            }
        } catch (e) {
            alert('Error creating environment: ' + e.message);
        }
    }

    updateMenuButton() {
        if (this.menuButton) {
            this.menuButton.textContent = "🌍 " + this.currentEnvironment;
        }
    }
}

// Initialize when app is ready
const envManager = new EnvironmentManager();

app.registerExtension({
    name: "ComfyUI.EnvironmentManager",
    async setup() {
        console.log("[EnvManager] Initializing...");
        await envManager.loadEnvironments();
        envManager.createMenuButton();
    }
});
