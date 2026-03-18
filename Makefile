all: cdk-deploy

setup: install-python install-node

install-python: venv/touchfile
venv/touchfile: requirements.txt
	@echo "Creating virtual environment..."
	python3 -m venv venv
	@echo "Activating venv..."
	. venv/bin/activate
	@echo "Installing Python requirements..."
	pip install -r requirements.txt
	touch venv/touchfile

install-node: node_modules
node_modules: package.json package-lock.json
	@echo "Installing Node.js requirements..."
	npm install

# Generate a unique stack name on first run, reuse on subsequent runs
.stack-name:
	@echo "ComfyUIStack-$$(shuf -i 100000-999999 -n 1 2>/dev/null || python3 -c 'import random; print(random.randint(100000,999999))')" > .stack-name
	@echo "Generated stack name: $$(cat .stack-name)"

STACK_NAME = $(shell cat .stack-name 2>/dev/null || echo "ComfyUIStack")

docker-build:
	@echo "Building Docker image..."
	docker build -t comfyui-aws:latest comfyui_aws_stack/docker/
	@echo "Docker image built successfully!"

cdk-bootstrap: setup
	@echo "Running cdk bootstrap..."
	npx cdk bootstrap

cdk-deploy: setup .stack-name
	@echo "Deploying stack: $(STACK_NAME)"
	npx cdk deploy -c stack_name=$(STACK_NAME)

cdk-deploy-force: setup .stack-name
	@echo "Deploying stack: $(STACK_NAME)"
	npx cdk deploy -c stack_name=$(STACK_NAME) --require-approval never

cdk-destroy: .stack-name
	@echo "Destroying stack: $(STACK_NAME)"
	npx cdk destroy -c stack_name=$(STACK_NAME) --force

stack-name: .stack-name
	@cat .stack-name

test: install-python
	pytest -vv

test-update: install-python
	pytest --snapshot-update

clean:
	@echo "Removing virtual environment and node modules..."
	rm -rf venv node_modules
