import { Actor } from 'apify';
import { PlaywrightCrawler } from '@crawlee/playwright';
import { ApifyStorageLocal } from '@apify/storage-local';

const mainOptions = {
    exit: Actor.isAtHome(),
    storage: process.env.STORAGE_IMPLEMENTATION === 'LOCAL' ? new ApifyStorageLocal() : undefined,
};

await Actor.main(async () => {
    const crawler = new PlaywrightCrawler({
        maxRequestRetries: 10,
        sessionPoolOptions: {
            sessionOptions: {
                maxErrorScore: 2,
            },
        },
        requestHandler: async ({ session }) => {
            const { id, usageCount, errorScore } = session;
            Actor.pushData({ id, usageCount, errorScore });
            throw new Error('retry');
        },
    });

    await crawler.run(['https://crawlee.dev/']);
}, mainOptions);
