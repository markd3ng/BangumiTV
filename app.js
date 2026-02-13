const fastify = require('fastify')({ logger: true });
const path = require('path');

// Register CORS
fastify.register(require('@fastify/cors'), {
  origin: '*',
});

// Register Static Files
fastify.register(require('@fastify/static'), {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Register New API Routes
fastify.register(require('./src/api/routes'), { prefix: '/api' });

// Legacy compatibility (optional, can be removed if frontend is updated simultaneously)
fastify.register(require('./src/api/routes'), { prefix: '/' });

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: '0.0.0.0' });
    console.log(`- [INFO] Server logic refactored. Listening on port 3000.`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
