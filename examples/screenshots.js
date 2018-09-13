/**
 * This example shows how to read and write
 * data to the default key-value store using
 * <a href="https://www.apify.com/docs/sdk/apify-runtime-js/latest#module-Apify-getValue"><code>Apify.getValue()</code></a>
 * and
 * <a href="https://www.apify.com/docs/sdk/apify-runtime-js/latest#module-Apify-setValue"><code>Apify.setValue()</code></a>.
 * The script crawls a list of URLs using Puppeteer,
 * captures a screenshot of each page and saves it to the store. The list of URLs is
 * provided as actor input that is also read from the store.
 *
 * In local configuration, the input is stored in the default key-value store's directory as JSON file at
 * `./apify_storage/key_value_stores/default/INPUT.json`. You need to create the file and set it the following content:
 *
 * ```json
 * { "sources": [{ "url": "https://www.google.com" }, { "url": "https://www.duckduckgo.com" }] }
 * ```
 *
 * On the Apify cloud platform, the input can be either set manually
 * in the UI app or passed as the POST payload to the
 * [Run actor API call](https://www.apify.com/docs/api/v2#/reference/actors/run-collection/run-actor).
 * For more details, see [Input and output](https://www.apify.com/docs/actor#input-output)
 * in the Apify Actor documentation.
 */

const Apify = require('apify');

Apify.main(async () => {
    // Read the actor input configuration containing URLs to take the screenshot off.
    // By convention, the input is present in actor's default key-value store under the "INPUT" key.
    const input = await Apify.getValue('INPUT');
    if (!input) throw new Error('Have you passed the correct INPUT ?');

    const { sources } = input;

    const requestList = new Apify.RequestList({ sources });
    await requestList.initialize();

    const crawler = new Apify.PuppeteerCrawler({
        requestList,
        handlePageFunction: async ({ page, request }) => {
            console.log(`Processing ${request.url}...`);

            // This is a Puppeteer function that takes a screenshot of the page and returns its buffer.
            const screenshotBuffer = await page.screenshot();

            // The record key may only include the following characters: a-zA-Z0-9!-_.'()
            const key = request.url.replace(/[:/]/g, '_');

            // Save the screenshot. Choosing the right content type will automatically
            // assign the local file the right extension, in this case .png.
            // The screenshots will be stored in ./apify_storage/key_value_stores/default/
            await Apify.setValue(key, screenshotBuffer, { contentType: 'image/png' });
            console.log(`Screenshot of ${request.url} saved.`);
        },
    });

    // Run crawler.
    await crawler.run();

    console.log('Crawler finished.');
});
