import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from '../config/index.js';
import { createChildLogger } from '../config/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

// Routes
import authRoutes from './routes/auth.routes.js';
import organizationsRoutes from './routes/organizations.routes.js';
import mapsRoutes from './routes/maps.routes.js';
import componentsRoutes from './routes/components.routes.js';
import permissionsRoutes from './routes/permissions.routes.js';
import gatewaysRoutes from './routes/gateways.routes.js';
import auditRoutes from './routes/audit.routes.js';
import groupsRoutes from './routes/groups.routes.js';
import checkResultsRoutes from './routes/check-results.routes.js';
import mcpRoutes from './routes/mcp.routes.js';
import gitopsRoutes from './routes/gitops.routes.js';
import workspacesRoutes from './routes/workspaces.routes.js';

const logger = createChildLogger('server');

export function createApp(): Express {
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: config.nodeEnv === 'production',
  }));

  // CORS
  app.use(cors({
    origin: config.cors.origin,
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
    message: { code: 'RATE_LIMITED', message: 'Too many requests' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', limiter);

  // Stricter rate limit for auth endpoints
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20, // 20 login attempts per 15 minutes
    message: { code: 'RATE_LIMITED', message: 'Too many login attempts' },
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api/v1/auth/login', authLimiter);
  app.use('/api/v1/auth/register', authLimiter);

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
      }, 'Request completed');
    });
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // API routes
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/organizations', organizationsRoutes);
  app.use('/api/v1/maps', mapsRoutes);
  app.use('/api/v1', componentsRoutes); // Components are nested under maps
  app.use('/api/v1', permissionsRoutes); // Permissions are nested under maps
  app.use('/api/v1', gatewaysRoutes); // Gateways, agents, jobs
  app.use('/api/v1', auditRoutes); // Audit logs
  app.use('/api/v1', groupsRoutes); // Groups (org-scoped + direct)
  app.use('/api/v1', checkResultsRoutes); // Check results and status
  app.use('/api/v1', mcpRoutes); // MCP Server
  app.use('/api/v1', gitopsRoutes); // GitOps (map export/import/sync)
  app.use('/api/v1/workspaces', workspacesRoutes); // Workspace CRUD

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler);

  return app;
}
