import { app } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';

let server = null;
let isShuttingDown = false;

export async function startServer(port = config.port, host = config.host) {
  return new Promise((resolve, reject) => {
    try {
      server = app.listen(port, host, () => {
        const startupLog = {
          event: 'startup',
          service: config.appName,
          config_version: config.configVersion,
          environment: config.environment,
          host,
          port,
          timestamp: new Date().toISOString()
        };
        console.log(JSON.stringify(startupLog));
        resolve(server);
      });
      server.on('error', (err) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function stopServer() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  const shutdownLog = {
    event: 'shutdown',
    service: config.appName,
    timestamp: new Date().toISOString()
  };
  console.log(JSON.stringify(shutdownLog));

  await new Promise((resolve) => {
    if (server) {
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections();
      }
      server.close(() => resolve());
    } else {
      resolve();
    }
  });

  await closePool();
  server = null;
  isShuttingDown = false;
}

process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await stopServer();
  process.exit(0);
});

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startServer().catch((err) => {
    console.error(JSON.stringify({
      event: 'startup_error',
      error: err.message,
      timestamp: new Date().toISOString()
    }));
    process.exit(1);
  });
}
