import axios from 'axios';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';

export default class BangumiService {
    constructor(config = {}) {
        this.baseUrl = 'https://api.bgm.tv';
        this.cdnUrl = 'https://cdn.jsdelivr.net/gh/czy0729/Bangumi-Subject@master/data';
        this.userAgent = config.userAgent || 'BangumiTV-Client/1.0 (https://github.com/markd3ng/BangumiTV)';
        this.cacheDir = path.resolve(process.cwd(), '.cache');
        this.imgProxyPrefix = config.imgProxyPrefix || '';

        this.headers = {
            'User-Agent': this.userAgent,
        };

        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Fetch user collection overview
     */
    async getUserCollections(username, type = 'watching', offset = 0, limit = 100) {
        // Map string types to v0 numeric types
        const typeMap = {
            'want': 1,
            'watched': 2,
            'watching': 3,
            'hold': 4,
            'dropped': 5
        };
        const apiType = typeMap[type] || 3;

        try {
            const url = `${this.baseUrl}/v0/users/${username}/collections`;
            const response = await axios.get(url, {
                params: { subject_type: 2, type: apiType, offset, limit },
                headers: this.headers
            });
            return response.data;
        } catch (error) {
            console.error(`- [ERROR] Failed to fetch collections for ${username}:`, error.message);
            throw error;
        }
    }

    /**
     * Fetch subject details with CDN-first strategy and caching
     */
    async getSubjectDetails(subjectId, forceRefresh = false) {
        const cachePath = path.join(this.cacheDir, `${subjectId}.json`);

        // 1. Check Cache
        if (!forceRefresh && fs.existsSync(cachePath)) {
            try {
                const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                return this._normalizeSubject(cachedData);
            } catch (e) {
                console.warn(`- [WARN] Failed to read cache for ${subjectId}, re-fetching...`);
            }
        }

        let subject = null;

        // 2. Try CDN
        const cdnFileUrl = `${this.cdnUrl}/${Math.floor(subjectId / 100)}/${subjectId}.json`;
        try {
            const response = await axios.get(cdnFileUrl, { headers: this.headers });
            subject = response.data;
        } catch (error) {
            console.log(`- [INFO] Subject ${subjectId} not in CDN. Falling back to API...`);

            // 3. Fallback to API (Wait 200ms for rate limiting)
            await new Promise(r => setTimeout(r, 200));
            try {
                const response = await axios.get(`${this.baseUrl}/v0/subjects/${subjectId}`, {
                    headers: this.headers
                });
                subject = response.data;
            } catch (apiError) {
                console.error(`- [ERROR] Failed to fetch subject ${subjectId} from both CDN and API`);
                // Return a minimal subject object if both fail to prevent crash
                return { id: subjectId, name: 'Unknown Subject', images: null };
            }
        }

        // 4. Cache & Normalize
        if (subject) {
            fs.writeFileSync(cachePath, JSON.stringify(subject, null, 2));
            return this._normalizeSubject(subject);
        }

        return null;
    }

    /**
   * Normalize subject data (Handle images, image proxy, etc.)
   */
    _normalizeSubject(subject) {
        // 1. Handle Images inconsistency (CDN vs API)
        if (!subject.images && subject.image) {
            const imageUrl = subject.image.startsWith('//') ? `https:${subject.image}` : subject.image;
            subject.images = {
                large: imageUrl,
                common: imageUrl,
                medium: imageUrl,
                small: imageUrl,
                grid: imageUrl,
            };
        }

        if (subject.images) {
            for (const key in subject.images) {
                let url = subject.images[key];

                // Ensure https
                if (url.startsWith('//')) {
                    url = `https:${url}`;
                } else if (url.startsWith('http:')) {
                    url = url.replace('http:', 'https:');
                }

                // 2. Apply Image Proxy if configured
                // Supports both prefix style and mirror.domain/{origin-uri} style
                if (this.imgProxyPrefix) {
                    if (this.imgProxyPrefix.includes('{origin-uri}')) {
                        // Pattern like https://proxy.com/{origin-uri}
                        url = this.imgProxyPrefix.replace('{origin-uri}', url);
                    } else {
                        // Simple prefix replacement
                        url = url.replace(/https?:\/\/lain\.bgm\.tv/, this.imgProxyPrefix.replace(/\/$/, ''));
                    }
                }

                subject.images[key] = url;
            }
        }

        // Ensure numeric fields exist
        // 'eps' can be an array of objects in some API responses, so we check for that
        if (Array.isArray(subject.eps)) {
            subject.eps = subject.eps.length;
        } else {
            subject.eps = subject.eps || subject.eps_count || 0;
        }

        return subject;
    }

    async getCalendar() {
        try {
            const response = await axios.get(`${this.baseUrl}/calendar`, { headers: this.headers });
            return response.data;
        } catch (error) {
            console.error('- [ERROR] Failed to fetch calendar:', error.message);
            return [];
        }
    }
}
