import { createServer } from 'http';
import { createApp } from './api/server.js';
import { config } from './config/index.js';
import { logger } from './config/logger.js';
import { checkConnection, closePool } from './db/connection.js';
import { initWebSocketServer, getWebSocketServer } from './websocket/server.js';

async function main(): Promise<void> {
  // Check database connection
  logger.info('Checking database connection...');
  const dbConnected = await checkConnection();
  if (!dbConnected) {
    logger.error('Failed to connect to database');
    process.exit(1);
  }
  logger.info('Database connection established');

  // Create Express app
  const app = createApp();

  // Create HTTP server
  const server = createServer(app);

  // Initialize WebSocket server
  initWebSocketServer(server);
  logger.info('WebSocket server initialized');

  // Start server
  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'OpsMap backend started');
    logger.info(`API: http://localhost:${config.port}/api/v1`);
    logger.info(`WebSocket: ws://localhost:${config.port}/ws`);
    logger.info(`Health: http://localhost:${config.port}/health`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Received shutdown signal');

    // Close WebSocket server
    const wsServer = getWebSocketServer();
    if (wsServer) {
      await wsServer.close();
    }

    // Close HTTP server
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Close database pool
    await closePool();

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start server');
  process.exit(1);
});
