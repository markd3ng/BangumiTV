const fs = require('fs');
const path = require('path');

async function routes(fastify, options) {
    const dataDir = path.resolve(process.cwd(), 'data');

    // Helper to load collection data
    const loadCollection = (type) => {
        const filePath = path.join(dataDir, `${type}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return null;
    };

    /**
     * Get collection data with pagination (v2 style)
     */
    fastify.get('/bangumi', async (request, reply) => {
        const { type, offset = 0, limit = 10 } = request.query;
        const collection = loadCollection(type);

        if (!collection) {
            return reply.code(404).send({ msg: `Collection ${type} not found` });
        }

        const start = parseInt(offset);
        const end = start + parseInt(limit);

        return {
            data: collection.data.slice(start, end),
            total: collection.total,
            updated_at: collection.updated_at
        };
    });

    /**
     * Get totals for all collections
     */
    fastify.get('/bangumi_total', async (request, reply) => {
        const types = ['watching', 'watched', 'want'];
        const res = {};
        for (const type of types) {
            const collection = loadCollection(type);
            res[type] = collection ? collection.total : 0;
        }
        return res;
    });

    /**
     * Get calendar data (Daily Bangumi)
     */
    fastify.get('/calendar', async (request, reply) => {
        const filePath = path.join(dataDir, 'calendar.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return [];
    });
}

module.exports = routes;
