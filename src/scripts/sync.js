const fs = require('fs');
const path = require('path');
require('dotenv').config();
const BangumiService = require('../services/bangumi.service');

async function sync() {
    const username = process.env.BANGUMI_USER;
    if (!username) {
        console.error('- [ERROR] BANGUMI_USER environment variable is not set.');
        process.exit(1);
    }

    const service = new BangumiService({
        imgProxyPrefix: process.env.IMG_PROXY_PREFIX || ''
    });

    const categories = ['watching', 'watched', 'want'];
    const dataDir = path.resolve(process.cwd(), 'data');

    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log(`- [START] Syncing data for user: ${username}`);

    // 1. Sync Collections
    for (const type of categories) {
        console.log(`- [INFO] Syncing ${type} collection...`);
        try {
            const collectionItems = await service.getUserCollections(username, type);
            const total = collectionItems.total || 0;
            const subjects = [];

            for (let i = 0; i < collectionItems.data.length; i++) {
                const item = collectionItems.data[i];
                const subjectId = item.subject_id;

                console.log(`  [${i + 1}/${collectionItems.data.length}] Loading subject ${subjectId}...`);
                const details = await service.getSubjectDetails(subjectId);

                // Merge collection metadata (like progress) with subject details
                subjects.push({
                    ...details,
                    ep_status: item.ep_status || 0,
                    collection_type: type,
                    updated_at: item.updated_at
                });
            }

            const result = {
                total,
                data: subjects,
                updated_at: new Date().toISOString()
            };

            fs.writeFileSync(
                path.join(dataDir, `${type}.json`),
                JSON.stringify(result, null, 2)
            );
            console.log(`- [SUCCESS] ${type} collection synced. Total: ${total}`);
        } catch (error) {
            console.error(`- [ERROR] Failed to sync ${type}:`, error.message);
        }
    }

    // 2. Sync Calendar
    console.log('- [INFO] Syncing calendar...');
    try {
        const calendarData = await service.getCalendar();

        // Sort and normalize calendar data
        const weekdayMap = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const normalizedCalendar = calendarData.map(day => ({
            weekday: day.weekday,
            items: (day.items || []).map(item => ({
                id: item.id,
                name: item.name,
                name_cn: item.name_cn,
                images: item.images,
                air_time: item.air_time,
                rating: item.rating
            }))
        }));

        fs.writeFileSync(
            path.join(dataDir, 'calendar.json'),
            JSON.stringify(normalizedCalendar, null, 2)
        );
        console.log('- [SUCCESS] Calendar synced.');
    } catch (error) {
        console.error('- [ERROR] Failed to sync calendar:', error.message);
    }

    console.log('- [FINISHED] Data synchronization complete.');
}

sync();
