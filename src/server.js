'use strict';

require('dotenv').config();

const { createApp }  = require('./app');
const { closePool }  = require('./config/database');
const logger         = require('./utils/logger');

const PORT = parseInt(process.env.PORT || '3000', 10);

async function start() {
  try {
    const app    = await createApp();
    const server = app.listen(PORT, () => {
      logger.info(`SiteMaintenance running on http://localhost:${PORT} (${process.env.NODE_ENV || 'development'})`);
    });

    // Start background jobs after server is up
    if (process.env.NODE_ENV !== 'test') {
      require('./jobs/dailyCron').start();
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info(`${signal} received — shutting down gracefully`);
      server.close(async () => {
        await closePool();
        logger.info('Server closed');
        process.exit(0);
      });
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled rejection:', reason);
    });

    process.on('uncaughtException', (err) => {
      logger.error('Uncaught exception:', err);
      process.exit(1);
    });

  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
