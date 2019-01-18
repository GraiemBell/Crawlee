import _ from 'underscore';
import fs from 'fs';
import os from 'os';
import path from 'path';
import util from 'util';
import log from 'apify-shared/log';
import LinkedList from 'apify-shared/linked_list';
import rimraf from 'rimraf';
import { checkParamOrThrow } from 'apify-client/build/utils';
import { launchPuppeteer } from './puppeteer';

/* global process */

const PROCESS_KILL_TIMEOUT_MILLIS = 5000;
const PAGE_CLOSE_KILL_TIMEOUT_MILLIS = 1000;

const DEFAULT_OPTIONS = {
    reusePages: false,
    // Don't make these too large, otherwise Puppeteer might start crashing weirdly,
    // and the default settings should just work
    maxOpenPagesPerInstance: 50,
    retireInstanceAfterRequestCount: 100,

    // These can't be constants because we need it for unit tests.
    instanceKillerIntervalMillis: 60 * 1000,
    killInstanceAfterMillis: 5 * 60 * 1000,

    // TODO: use settingsRotator()
    launchPuppeteerFunction: launchPuppeteerOptions => launchPuppeteer(launchPuppeteerOptions),

    recycleDiskCache: false,
};

const mkdtempAsync = util.promisify(fs.mkdtemp);
const rimrafAsync = util.promisify(rimraf);
const DISK_CACHE_DIR = path.join(os.tmpdir(), 'puppeteer_disk_cache-');

/**
 * Deletes Chrome's user data directory
 * @param {String} diskCacheDir
 * @ignore
 */
const deleteDiskCacheDir = (diskCacheDir) => {
    log.debug('PuppeteerPool: Deleting disk cache directory', { diskCacheDir });
    return rimrafAsync(diskCacheDir)
        .catch((err) => {
            log.warning('PuppeteerPool: Cannot delete Chrome disk cache directory', { diskCacheDir, errorMessage: err.message });
        });
};

/**
 * Internal representation of Puppeteer instance.
 *
 * @ignore
 */
class PuppeteerInstance {
    constructor(id, browserPromise) {
        this.id = id;
        this.activePages = 0;
        this.totalPages = 0;
        this.browserPromise = browserPromise;
        this.lastPageOpenedAt = Date.now();
        this.killed = false;
        this.childProcess = null;
        this.recycleDiskCacheDir = null;
    }
}

/**
 * Manages a pool of Chrome browser instances controlled using
 * <a href="https://github.com/GoogleChrome/puppeteer" target="_blank">Puppeteer</a>.
 *
 * `PuppeteerPool` reuses Chrome instances and tabs using specific browser rotation and retirement policies.
 * This is useful in order to facilitate rotation of proxies, cookies
 * or other settings in order to prevent detection of your web scraping bot,
 * access web pages from various countries etc.
 *
 * Additionally, the reuse of browser instances instances speeds up crawling,
 * and the retirement of instances helps mitigate effects of memory leaks in Chrome.
 *
 * `PuppeteerPool` is internally used by the {@link PuppeteerCrawler} class.
 *
 * **Example usage:**
 *
 * ```javascript
 * const puppeteerPool = new PuppeteerPool({
 *   launchPuppeteerFunction: () => {
 *     // Use a new proxy with a new IP address for each new Chrome instance
 *     return Apify.launchPuppeteer({
 *        apifyProxySession: Math.random(),
 *     });
 *   },
 * });
 *
 * const page1 = await puppeteerPool.newPage();
 * const page2 = await puppeteerPool.newPage();
 * const page3 = await puppeteerPool.newPage();
 *
 * // ... do something with the pages ...
 *
 * // Close all browsers.
 * await puppeteerPool.destroy();
 * ```
 * @param {Object} [options] All `PuppeteerPool` parameters are passed
 *   via an options object with the following keys:
 * @param {boolean} [options.reusePages=false]
 *   Individual browser tabs will be reused after their task is complete instead
 *   of closing them and spawning a new tab. This saves CPU resources.
 *   Try disabling this feature if you encounter any weird behavior in your crawlers.
 * @param {Number} [options.maxOpenPagesPerInstance=50]
 *   Maximum number of open pages (i.e. tabs) per browser. When this limit is reached, new pages are loaded in a new browser instance.
 * @param {Number} [options.retireInstanceAfterRequestCount=100]
 *   Maximum number of requests that can be processed by a single browser instance.
 *   After the limit is reached, the browser is retired and new requests are
 *   handled by a new browser instance.
 * @param {Number} [options.instanceKillerIntervalMillis=60000]
 *   Indicates how often are the open Puppeteer instances checked whether they can be closed.
 * @param {Number} [options.killInstanceAfterMillis=300000]
 *   When Puppeteer instance reaches the `options.retireInstanceAfterRequestCount` limit then
 *   it is considered retired and no more tabs will be opened. After the last tab is closed the
 *   whole browser is closed too. This parameter defines a time limit between the last tab was opened and
 *   before the browser is closed even if there are pending open tabs.
 * @param {Function} [options.launchPuppeteerFunction]
 *   Overrides the default function to launch a new Puppeteer instance.
 *   The function must return a promise resolving to
 *   [`Browser`](https://github.com/GoogleChrome/puppeteer/blob/master/docs/api.md#class-browser) instance.
 *   See the source code on
 *   <a href="https://github.com/apifytech/apify-js/blob/master/src/puppeteer_pool.js#L28" target="_blank">GitHub</a>
 *   for the default implementation.
 * @param {LaunchPuppeteerOptions} [options.launchPuppeteerOptions]
 *   Options used by `Apify.launchPuppeteer()` to start new Puppeteer instances.
 *   See [`LaunchPuppeteerOptions`](../typedefs/launchpuppeteeroptions).
 * @param {String[]} [options.proxyUrls]
 *   An array of custom proxy URLs to be used by the `PuppeteerPool` instance.
 *   The provided custom proxies' order will be randomized and the resulting list rotated.
 *   Custom proxies are not compatible with Apify Proxy and an attempt to use both
 *   configuration options will cause an error to be thrown on startup.
 */
class PuppeteerPool {
    constructor(options = {}) {
        checkParamOrThrow(options, 'options', 'Object');

        // For backwards compatibility, in the future we can remove this...
        if (!options.retireInstanceAfterRequestCount && options.abortInstanceAfterRequestCount) {
            log.warning('PuppeteerPool: Parameter `abortInstanceAfterRequestCount` is deprecated! Use `retireInstanceAfterRequestCount` instead!');
            options.retireInstanceAfterRequestCount = options.abortInstanceAfterRequestCount;
        }

        const {
            reusePages,
            maxOpenPagesPerInstance,
            retireInstanceAfterRequestCount,
            launchPuppeteerFunction,
            instanceKillerIntervalMillis,
            killInstanceAfterMillis,
            launchPuppeteerOptions,
            // recycleDiskCache,
            proxyUrls,
        } = _.defaults({}, options, DEFAULT_OPTIONS);

        // Disabling the feature since tests started failing.
        // Re-enable once the issues upstream are fixed.
        const recycleDiskCache = false;

        checkParamOrThrow(reusePages, 'options.reusePages', 'Boolean');
        checkParamOrThrow(maxOpenPagesPerInstance, 'options.maxOpenPagesPerInstance', 'Number');
        checkParamOrThrow(retireInstanceAfterRequestCount, 'options.retireInstanceAfterRequestCount', 'Number');
        checkParamOrThrow(launchPuppeteerFunction, 'options.launchPuppeteerFunction', 'Function');
        checkParamOrThrow(instanceKillerIntervalMillis, 'options.instanceKillerIntervalMillis', 'Number');
        checkParamOrThrow(killInstanceAfterMillis, 'options.killInstanceAfterMillis', 'Number');
        checkParamOrThrow(launchPuppeteerOptions, 'options.launchPuppeteerOptions', 'Maybe Object');
        checkParamOrThrow(recycleDiskCache, 'options.recycleDiskCache', 'Maybe Boolean');
        checkParamOrThrow(proxyUrls, 'options.proxyUrls', 'Maybe Array');
        // Enforce non-empty proxyUrls array
        if (proxyUrls && !proxyUrls.length) throw new Error('Parameter "options.proxyUrls" of type Array must not be empty');

        // The recycleDiskCache option is only supported in headful mode
        // See https://bugs.chromium.org/p/chromium/issues/detail?id=882431
        if (recycleDiskCache
            && ((!launchPuppeteerOptions
                || (launchPuppeteerOptions && launchPuppeteerOptions.headless)
                || (launchPuppeteerOptions && launchPuppeteerOptions.headless === undefined && !launchPuppeteerOptions.devtools)))) {
            log.warning('PuppeteerPool: The "recycleDiskCache" is currently only supported in headful mode. Disk cache will not be recycled.');
        }

        // Config.
        this.reusePages = reusePages;
        this.maxOpenPagesPerInstance = maxOpenPagesPerInstance;
        this.retireInstanceAfterRequestCount = retireInstanceAfterRequestCount;
        this.killInstanceAfterMillis = killInstanceAfterMillis;
        this.recycledDiskCacheDirs = recycleDiskCache ? new LinkedList() : null;
        this.proxyUrls = proxyUrls ? _.shuffle(proxyUrls) : null;
        this.launchPuppeteerFunction = async () => {
            // Do not modify passed launchPuppeteerOptions!
            const opts = _.clone(launchPuppeteerOptions) || {};
            opts.args = _.clone(opts.args || []);

            // If requested, use recycled disk cache directory
            let diskCacheDir = null;
            if (recycleDiskCache) {
                diskCacheDir = this.recycledDiskCacheDirs.length > 0
                    ? this.recycledDiskCacheDirs.removeFirst()
                    : await mkdtempAsync(DISK_CACHE_DIR);
                opts.args.push(`--disk-cache-dir=${diskCacheDir}`);
            }

            // Rotate custom proxyUrls.
            if (this.proxyUrls) {
                opts.proxyUrl = this.proxyUrls[this.lastUsedProxyUrlIndex++ % this.proxyUrls.length];
            }

            const browser = await launchPuppeteerFunction(opts);
            if (!browser || typeof browser.newPage !== 'function') {
                // eslint-disable-next-line max-len
                throw new Error("The custom 'launchPuppeteerFunction' passed to PuppeteerPool must return a promise resolving to Puppeteer's Browser instance.");
            }
            browser.recycleDiskCacheDir = diskCacheDir;
            return browser;
        };

        // State.
        this.browserCounter = 0;
        this.activeInstances = {};
        this.retiredInstances = {};
        this.lastUsedProxyUrlIndex = 0;
        this.instanceKillerInterval = setInterval(() => this._killRetiredInstances(), instanceKillerIntervalMillis);
        this.idlePages = [];
        // WeakSet/Map items do not prevent garbage collection,
        // and thus no management of the collections is needed.
        // They will automatically empty themselves once there
        // are no references to the stored pages.
        this.closedPages = new WeakSet();
        this.pagesToInstancesMap = new WeakMap();

        // ensure termination on SIGINT
        this.sigintListener = () => this._killAllInstances();
        process.on('SIGINT', this.sigintListener);
    }

    /**
     * Launches new browser instance.
     *
     * @ignore
     */
    _launchInstance() {
        const id = this.browserCounter++;
        log.debug('PuppeteerPool: launching new browser', { id });

        const browserPromise = this.launchPuppeteerFunction();
        const instance = new PuppeteerInstance(id, browserPromise);
        this.activeInstances[id] = instance;

        // Handle the async stuff elsewhere.
        this._initBrowser(browserPromise, instance);

        return instance;
    }

    /**
     * Takes care of async processes in PuppeteerInstance construction with a Browser.
     * @param {Promise<Browser>} browserPromise
     * @param {PuppeteerInstance} instance
     * @returns {Promise}
     * @ignore
     */
    async _initBrowser(browserPromise, instance) {
        const { id } = instance;
        let browser;
        try {
            browser = await browserPromise;
        } catch (err) {
            log.exception(err, 'PuppeteerPool: browser launch failed', { id });
            delete this.activeInstances[id];
            return;
        }

        instance.childProcess = browser.process();
        instance.recycleDiskCacheDir = browser.recycleDiskCacheDir;

        browser.on('disconnected', () => {
            // If instance.killed === true then we killed the instance so don't log it.
            if (!instance.killed) log.error('PuppeteerPool: Puppeteer sent "disconnect" event. Maybe it crashed???', { id });
            this._retireInstance(instance);
        });
        // This one is done manually in Puppeteerpool.newPage() so that it happens immediately.
        // browser.on('targetcreated', () => instance.activePages++);
        browser.on('targetdestroyed', (target) => {
            // The event is also called for service workers and Chromium extensions, which must be ignored!
            const type = target.type();
            if (type !== 'page' && type !== 'other') return;

            instance.activePages--;

            if (instance.activePages === 0 && this.retiredInstances[id]) {
                // Run this with a delay, otherwise page.close() that initiated this 'targetdestroyed' event
                // might fail with "Protocol error (Target.closeTarget): Target closed."
                // TODO: Alternatively we could close here the first about:blank tab, which will cause
                // the browser to be closed immediately without waiting
                setTimeout(() => {
                    log.debug('PuppeteerPool: killing retired browser because it has no active pages', { id });
                    this._killInstance(instance);
                }, PAGE_CLOSE_KILL_TIMEOUT_MILLIS);
            }
        });
    }

    /**
     * Retires some of the instances for example due to many uses.
     *
     * @ignore
     */
    _retireInstance(instance) {
        const { id } = instance;

        if (!this.activeInstances[id]) return log.debug('PuppeteerPool: browser is retired already', { id });

        log.debug('PuppeteerPool: retiring browser', { id });

        this.retiredInstances[id] = instance;
        delete this.activeInstances[id];
    }

    /**
     * Kills all the retired instances that:
     * - have all tabs closed
     * - or are inactive for more then killInstanceAfterMillis.
     *
     * @ignore
     */
    _killRetiredInstances() {
        log.debug('PuppeteerPool: retired browsers count', { count: _.values(this.retiredInstances).length });

        _.mapObject(this.retiredInstances, async (instance) => {
            // Kill instances that are more than this.killInstanceAfterMillis from last opened page
            if (Date.now() - instance.lastPageOpenedAt > this.killInstanceAfterMillis) {
                log.debug('PuppeteerPool: killing retired browser after period of inactivity', { id: instance.id, killInstanceAfterMillis: this.killInstanceAfterMillis }); // eslint-disable-line max-len
                this._killInstance(instance);
                return;
            }

            try {
                const browser = await instance.browserPromise;
                const pages = await browser.pages();
                // NOTE: we are killing instance when the number of pages is less or equal to 1 because there is always about:blank page.
                if (pages.length <= 1) {
                    log.debug('PuppeteerPool: killing retired browser because it has no open tabs', { id: instance.id });
                    this._killInstance(instance);
                }
            } catch (err) {
                log.exception(err, 'PuppeteerPool: browser.pages() failed', { id: instance.id });
                this._killInstance(instance);
            }
        });
    }

    /**
     * Kills given browser instance.
     *
     * @ignore
     */
    async _killInstance(instance) {
        const { id, childProcess, killed, browserPromise } = instance;
        if (killed) return;

        log.debug('PuppeteerPool: killing browser', { id });

        delete this.retiredInstances[id];

        const recycleDiskCache = () => {
            if (!instance.recycleDiskCacheDir) return;
            log.debug('PuppeteerPool: recycling disk cache dir', { id, diskCacheDir: instance.recycleDiskCacheDir });
            this.recycledDiskCacheDirs.add(instance.recycleDiskCacheDir);
            instance.recycleDiskCacheDir = null;
        };

        // Ensure that Chrome process will be really killed.
        setTimeout(() => {
            // This is here because users reported that it happened
            // that error `TypeError: Cannot read property 'kill' of null` was thrown.
            // Likely Chrome process wasn't started due to some error ...
            if (childProcess) childProcess.kill('SIGKILL');

            recycleDiskCache();
        }, PROCESS_KILL_TIMEOUT_MILLIS);

        try {
            const browser = await browserPromise;
            instance.killed = true;
            await browser.close();
            recycleDiskCache();
        } catch (err) {
            log.exception(err, 'PuppeteerPool: cannot close the browser instance', { id });
        }
    }

    /**
     * Kills all running PuppeteerInstances.
     * @ignore
     */
    _killAllInstances() {
        // TODO: delete all dirs
        const allInstances = Object.values(this.activeInstances).concat(Object.values(this.retiredInstances));
        allInstances.forEach((instance) => {
            try {
                instance.childProcess.kill('SIGINT');
            } catch (e) {
                // do nothing, it's dead
            }
        });
    }

    /**
     * Updates the instance metadata when a new page is opened.
     *
     * @param {PuppeteerInstance} instance
     * @ignore
     */
    _incrementPageCount(instance) {
        instance.lastPageOpenedAt = Date.now();
        instance.totalPages++;
        if (instance.totalPages >= this.retireInstanceAfterRequestCount) this._retireInstance(instance);
    }

    /**
     * Produces a new page instance either by reusing an idle page that currently isn't processing
     * any request or by spawning a new page (new browser tab) in one of the available
     * browsers when no idle pages are available.
     *
     * To spawn a new browser tab for each page, set the `reusePages` constructor option to false.
     *
     * @return {Promise<Page>}
     */
    async newPage() {
        let idlePage;
        // We don't need to check whether options.reusePages is true,
        // because if it's false, the array will be empty and the loop will never start.
        while (idlePage = this.idlePages.shift()) { // eslint-disable-line no-cond-assign
            // Since pages can close for various reasons that we have no control over,
            // we need to make sure that we're only using live pages, so we go
            // through the queue until we get a page that's live, which means
            // that it's not closed and its browser is not retired.
            const pageIsNotClosed = !this.closedPages.has(idlePage);
            const instance = this.pagesToInstancesMap.get(idlePage);
            const instanceIsActive = !!this.activeInstances[instance.id];
            if (pageIsNotClosed && instanceIsActive) {
                this._incrementPageCount(instance);
                return idlePage;
            }
            // Close pages of retired instances so they don't keep hanging there forever.
            if (pageIsNotClosed && !instanceIsActive) {
                await idlePage.close();
            }
        }
        // If there are no live pages to be reused, we spawn a new tab.
        return this._openNewTab();
    }

    /**
     * Opens new tab in one of the browsers in the pool and returns a `Promise`
     * that resolves to an instance of a Puppeteer
     * <a href="https://pptr.dev/#?product=Puppeteer&show=api-class-page" target="_blank"><code>Page</code></a>.
     *
     * @return {Promise<Page>}
     * @ignore
     */
    async _openNewTab() {
        let instance = Object
            .values(this.activeInstances)
            .find(inst => inst.activePages < this.maxOpenPagesPerInstance);

        if (!instance) instance = this._launchInstance();
        this._incrementPageCount(instance);
        instance.activePages++;

        try {
            const browser = await instance.browserPromise;
            const page = await browser.newPage();
            this.pagesToInstancesMap.set(page, instance);
            return this._decoratePage(page);
        } catch (err) {
            log.exception(err, 'PuppeteerPool: browser.newPage() failed', { id: instance.id });
            this._retireInstance(instance);

            // !TODO: don't throw an error but repeat newPage with some delay
            throw err;
        }
    }

    /**
     * Adds the necessary boilerplate to allow page reuse and also
     * captures page.close() errors to prevent meaningless log clutter.
     * @param page
     * @ignore
     */
    _decoratePage(page) {
        const originalPageClose = page.close;
        page.close = async (...args) => {
            this.closedPages.add(page);
            return originalPageClose.apply(page, args)
                .catch((err) => {
                    const instance = this.pagesToInstancesMap.get(page);
                    log.debug('PuppeteerPool: Page.close() failed', { errorMessage: err.message, id: instance.id });
                });
        };

        page.once('error', (error) => {
            log.exception(error, 'PuppeteerPool: page crashed.');
            page.close();
        });
        return page;
    }

    /**
     * Closes all open browsers.
     * @return {Promise}
     */
    async destroy() {
        clearInterval(this.instanceKillerInterval);
        process.removeListener('SIGINT', this.sigintListener);

        // TODO: delete of dir doesn't seem to work!

        const browserPromises = _
            .values(this.activeInstances)
            .concat(_.values(this.retiredInstances))
            .map((instance) => {
                // This is needed so that "Puppeteer disconnected" errors are not printed.
                instance.killed = true;

                return instance.browserPromise;
            });

        const closePromises = browserPromises.map(async (browserPromise) => {
            const browser = await browserPromise;
            await browser.close();
            if (browser.recycleDiskCacheDir) await deleteDiskCacheDir(browser.recycleDiskCacheDir);
        });

        try {
            await Promise.all(closePromises);
            // Delete all cache directories
            const dirDeletionPromises = [];
            while (this.recycledDiskCacheDirs && this.recycledDiskCacheDirs.length > 0) {
                dirDeletionPromises.push(deleteDiskCacheDir(this.recycledDiskCacheDirs.removeFirst()));
            }
            await Promise.all(dirDeletionPromises);
        } catch (err) {
            log.exception(err, 'PuppeteerPool: cannot close the browsers');
        }
    }

    /**
     * Finds a PuppeteerInstance given a Puppeteer Browser running in the instance.
     * @param {Browser} browser
     * @return {Promise}
     * @ignore
     */
    async _findInstanceByBrowser(browser) {
        const instances = Object.values(this.activeInstances);
        const resultPromises = instances.map(async (instance) => {
            const savedBrowser = await instance.browserPromise;
            return browser === savedBrowser ? instance : null;
        });
        const results = (await Promise.all(resultPromises)).filter(i => i);
        switch (results.length) {
        case 0:
            return null;
        case 1:
            return results[0];
        default:
            throw new Error('PuppeteerPool: Multiple instances of PuppeteerPool found using a single browser instance.');
        }
    }

    /**
     * Manually retires a Puppeteer
     * <a href="https://pptr.dev/#?product=Puppeteer&show=api-class-browser" target="_blank"><code>Browser</code></a>
     * instance from the pool. The browser will continue to process open pages so that they may gracefully finish.
     * This is unlike `browser.close()` which will forcibly terminate the browser and all open pages will be closed.
     * @param {Browser} browser
     * @return {Promise}
     */
    async retire(browser) {
        const instance = await this._findInstanceByBrowser(browser);
        if (instance) return this._retireInstance(instance);
        log.debug('PuppeteerPool: browser is retired already');
    }

    /**
     * Recycles the page, which means that it will be enqueued for future reuse
     * instead of spawning a new tab. This is done automatically unless the `reusePages`
     * option of the `PuppeteerPool` constructor is set to false. You can also use this
     * function manually to tell the pool that you no longer need this specific page
     * and it can be reused in the future.
     *
     * Using this function without setting the `reusePages` option to false causes
     * this function to trigger a page.close().
     *
     * @param {Page} page
     * @return {Promise}
     */
    async recyclePage(page) {
        if (this.reusePages) {
            page.removeAllListeners();
            this.idlePages.push(page);
        } else {
            await page.close();
        }
    }
}

export default PuppeteerPool;
