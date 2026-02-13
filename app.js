import Fastify from 'fastify';
import path from 'path';
import { fileURLToPath } from 'url';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import routes from './src/api/routes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fastify = Fastify({ logger: true });

// Register CORS
fastify.register(fastifyCors, {
  origin: '*',
});

// Register Static Files
fastify.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/',
});

// Register New API Routes
fastify.register(routes, { prefix: '/api' });

// Legacy compatibility
fastify.register(routes, { prefix: '/' });

// Run the server!
const start = async () => {
  try {
    await fastify.listen({ port: parseInt(process.env.PORT) || 3000, host: '0.0.0.0' });
    console.log(`- [INFO] Server logic refactored to ESM. Listening...`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const isMain = import.meta.url === `file://${fileURLToPath(import.meta.url)}`; // Simplistic check or just don't auto-call

// Only start if not imported (using a more robust check for ESM main)
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  start();
}

export default fastify;
