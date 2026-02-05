#!/bin/bash
# scripts/init-project.sh
# Initialize the OpsMap monorepo structure

set -e

echo "🚀 Initializing OpsMap project..."

# Create root structure
mkdir -p docs scripts/pki deploy/{docker,kubernetes,helm}

# ══════════════════════════════════════════════════════════════════════════════
# AGENT (Rust)
# ══════════════════════════════════════════════════════════════════════════════
echo "📦 Creating Agent (Rust)..."

mkdir -p agent/src/{config,connection,executor,scheduler,native_commands,discovery,buffer}

cat > agent/Cargo.toml << 'EOF'
[package]
name = "opsmap-agent"
version = "0.1.0"
edition = "2021"
authors = ["OpsMap Team"]
description = "OpsMap Agent - Semi-autonomous monitoring and control agent"

[dependencies]
# Async runtime
tokio = { version = "1.35", features = ["full"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde_yaml = "0.9"

# WebSocket
tokio-tungstenite = { version = "0.21", features = ["rustls-tls-native-roots"] }
futures-util = "0.3"

# HTTP client (fallback)
reqwest = { version = "0.11", features = ["json", "rustls-tls"] }

# TLS
rustls = "0.22"
rustls-pemfile = "2.0"
tokio-rustls = "0.25"

# System info
sysinfo = "0.30"
nix = { version = "0.27", features = ["process", "signal", "user", "fs"] }

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# Error handling
thiserror = "1.0"
anyhow = "1.0"

# Config
config = "0.14"

# Time
chrono = { version = "0.4", features = ["serde"] }

# UUID
uuid = { version = "1.6", features = ["v4", "serde"] }

# Crypto (for checksums)
sha2 = "0.10"
md-5 = "0.10"

[dev-dependencies]
tokio-test = "0.4"
tempfile = "3.9"

[[bin]]
name = "opsmap-agent"
path = "src/main.rs"

[profile.release]
lto = true
codegen-units = 1
strip = true
EOF

cat > agent/src/main.rs << 'EOF'
use anyhow::Result;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod config;
mod connection;
mod executor;
mod scheduler;
mod native_commands;
mod discovery;
mod buffer;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(true)
        .json()
        .init();

    info!("Starting OpsMap Agent v{}", env!("CARGO_PKG_VERSION"));

    // TODO: Load config
    // TODO: Initialize components
    // TODO: Connect to gateway
    // TODO: Start scheduler
    // TODO: Main loop

    Ok(())
}
EOF

# Create mod.rs for each module
for module in config connection executor scheduler native_commands discovery buffer; do
    cat > agent/src/$module/mod.rs << EOF
//! $module module

// TODO: Implement $module
EOF
done

# ══════════════════════════════════════════════════════════════════════════════
# GATEWAY (Rust)
# ══════════════════════════════════════════════════════════════════════════════
echo "📦 Creating Gateway (Rust)..."

mkdir -p gateway/src/{agent_server,backend_client,registry,router}

cat > gateway/Cargo.toml << 'EOF'
[package]
name = "opsmap-gateway"
version = "0.1.0"
edition = "2021"
authors = ["OpsMap Team"]
description = "OpsMap Gateway - Zone relay for agents"

[dependencies]
# Async runtime
tokio = { version = "1.35", features = ["full"] }

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
serde_yaml = "0.9"

# WebSocket
tokio-tungstenite = { version = "0.21", features = ["rustls-tls-native-roots"] }
futures-util = "0.3"

# HTTP server (for fallback)
axum = { version = "0.7", features = ["ws"] }
tower = "0.4"

# TLS
rustls = "0.22"
rustls-pemfile = "2.0"
tokio-rustls = "0.25"

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }

# Error handling
thiserror = "1.0"
anyhow = "1.0"

# Config
config = "0.14"

# Time
chrono = { version = "0.4", features = ["serde"] }

# UUID
uuid = { version = "1.6", features = ["v4", "serde"] }

# Concurrent data structures
dashmap = "5.5"

[dev-dependencies]
tokio-test = "0.4"

[[bin]]
name = "opsmap-gateway"
path = "src/main.rs"

[profile.release]
lto = true
codegen-units = 1
strip = true
EOF

cat > gateway/src/main.rs << 'EOF'
use anyhow::Result;
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

mod agent_server;
mod backend_client;
mod registry;
mod router;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(true)
        .json()
        .init();

    info!("Starting OpsMap Gateway v{}", env!("CARGO_PKG_VERSION"));

    // TODO: Load config
    // TODO: Initialize agent server
    // TODO: Connect to backend
    // TODO: Start routing

    Ok(())
}
EOF

# Create mod.rs for each module
for module in agent_server backend_client registry router; do
    cat > gateway/src/$module/mod.rs << EOF
//! $module module

// TODO: Implement $module
EOF
done

# ══════════════════════════════════════════════════════════════════════════════
# BACKEND (Node.js/TypeScript)
# ══════════════════════════════════════════════════════════════════════════════
echo "📦 Creating Backend (Node.js/TypeScript)..."

mkdir -p backend/src/{api/{routes,middleware},websocket,mcp,core/{maps,commands,permissions,fsm},gitops,db,auth}

cat > backend/package.json << 'EOF'
{
  "name": "opsmap-backend",
  "version": "0.1.0",
  "description": "OpsMap Backend - API and orchestration server",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "lint": "eslint src/**/*.ts",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "express": "^4.18.2",
    "ws": "^8.16.0",
    "pg": "^8.11.3",
    "redis": "^4.6.12",
    "jsonwebtoken": "^9.0.2",
    "bcrypt": "^5.1.1",
    "openid-client": "^5.6.4",
    "zod": "^3.22.4",
    "pino": "^8.17.2",
    "pino-pretty": "^10.3.1",
    "uuid": "^9.0.1",
    "simple-git": "^3.22.0",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/ws": "^8.5.10",
    "@types/pg": "^8.10.9",
    "@types/jsonwebtoken": "^9.0.5",
    "@types/bcrypt": "^5.0.2",
    "@types/uuid": "^9.0.7",
    "@types/node": "^20.10.6",
    "typescript": "^5.3.3",
    "tsx": "^4.7.0",
    "vitest": "^1.1.3",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.17.0",
    "@typescript-eslint/parser": "^6.17.0"
  }
}
EOF

cat > backend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
EOF

cat > backend/src/index.ts << 'EOF'
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// Middleware
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '0.1.0' });
});

// API routes
// TODO: Add routes

// WebSocket handling
wss.on('connection', (ws) => {
  logger.info('WebSocket client connected');
  
  ws.on('message', (message) => {
    // TODO: Handle messages
  });
  
  ws.on('close', () => {
    logger.info('WebSocket client disconnected');
  });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`OpsMap Backend listening on port ${PORT}`);
});
EOF

# ══════════════════════════════════════════════════════════════════════════════
# FRONTEND (React)
# ══════════════════════════════════════════════════════════════════════════════
echo "📦 Creating Frontend (React)..."

mkdir -p frontend/src/{components,pages,hooks,api,stores,lib}

cat > frontend/package.json << 'EOF'
{
  "name": "opsmap-frontend",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src/**/*.{ts,tsx}"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.21.1",
    "@tanstack/react-query": "^5.17.0",
    "zustand": "^4.4.7",
    "axios": "^1.6.5",
    "mermaid": "^10.6.1",
    "lucide-react": "^0.303.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.47",
    "@types/react-dom": "^18.2.18",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.33",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.3.3",
    "vite": "^5.0.11",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.17.0",
    "@typescript-eslint/parser": "^6.17.0"
  }
}
EOF

cat > frontend/vite.config.ts << 'EOF'
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
});
EOF

cat > frontend/tailwind.config.js << 'EOF'
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
EOF

cat > frontend/postcss.config.js << 'EOF'
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
EOF

cat > frontend/tsconfig.json << 'EOF'
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
EOF

cat > frontend/tsconfig.node.json << 'EOF'
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
EOF

cat > frontend/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>OpsMap</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
EOF

cat > frontend/src/main.tsx << 'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
EOF

cat > frontend/src/App.tsx << 'EOF'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          <header className="bg-white shadow">
            <div className="max-w-7xl mx-auto px-4 py-4">
              <h1 className="text-2xl font-bold text-gray-900">OpsMap</h1>
            </div>
          </header>
          <main className="max-w-7xl mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<div>Dashboard (TODO)</div>} />
              <Route path="/maps" element={<div>Maps (TODO)</div>} />
              <Route path="/maps/:id" element={<div>Map Detail (TODO)</div>} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
EOF

cat > frontend/src/index.css << 'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF

# ══════════════════════════════════════════════════════════════════════════════
# DOCKER
# ══════════════════════════════════════════════════════════════════════════════
echo "🐳 Creating Docker files..."

cat > deploy/docker/docker-compose.dev.yaml << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: opsmap
      POSTGRES_USER: opsmap
      POSTGRES_PASSWORD: opsmap_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  backend:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.backend
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://opsmap:opsmap_dev@postgres:5432/opsmap
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-secret-change-in-prod
    depends_on:
      - postgres
      - redis

  frontend:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.frontend
    ports:
      - "5173:80"
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
EOF

cat > deploy/docker/Dockerfile.backend << 'EOF'
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Production stage (distroless)
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3000

CMD ["dist/index.js"]
EOF

cat > deploy/docker/Dockerfile.frontend << 'EOF'
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Production stage
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
EOF

cat > deploy/docker/nginx.conf << 'EOF'
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /ws {
        proxy_pass http://backend:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
EOF

# ══════════════════════════════════════════════════════════════════════════════
# ROOT FILES
# ══════════════════════════════════════════════════════════════════════════════
echo "📄 Creating root files..."

cat > .gitignore << 'EOF'
# Dependencies
node_modules/
target/

# Build outputs
dist/
build/

# IDE
.idea/
.vscode/
*.swp
*.swo

# Environment
.env
.env.local
.env.*.local

# Logs
*.log
logs/

# OS
.DS_Store
Thumbs.db

# Certificates (keep templates)
*.crt
*.key
*.pem
!**/certs/*.example.*

# Database
*.db
*.sqlite
EOF

cat > README.md << 'EOF'
# OpsMap

Lightweight AIOps tool for mapping, monitoring, and controlling enterprise applications.

## Quick Start

```bash
# Development with Docker
docker-compose -f deploy/docker/docker-compose.dev.yaml up

# Or run components individually:

# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev

# Agent (Rust)
cd agent && cargo run

# Gateway (Rust)
cd gateway && cargo run
```

## Documentation

- [Full Specification](docs/opsmap-specification-v3.md)
- [Claude Code Instructions](CLAUDE.md)

## License

Apache 2.0
EOF

# ══════════════════════════════════════════════════════════════════════════════
# DONE
# ══════════════════════════════════════════════════════════════════════════════
echo ""
echo "✅ OpsMap project structure created!"
echo ""
echo "Next steps:"
echo "  1. cd into the project directory"
echo "  2. Copy docs/opsmap-specification-v3.md to docs/"
echo "  3. Run: docker-compose -f deploy/docker/docker-compose.dev.yaml up"
echo "  4. Start coding with Claude Code!"
echo ""
