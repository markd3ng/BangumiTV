import * as dotenv from "dotenv";
dotenv.config();
import Fastify from "fastify";
import appInstance from "../app.js";

const app = Fastify({
  logger: true,
});

app.register(appInstance);

export default async (req, res) => {
  await app.ready();
  app.server.emit('request', req, res);
}