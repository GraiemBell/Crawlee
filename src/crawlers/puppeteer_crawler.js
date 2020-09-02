import { checkParamOrThrow } from 'apify-client/build/utils';
import { checkParamPrototypeOrThrow } from 'apify-shared/utilities';
import * as _ from 'underscore';
import PuppeteerPool from '../puppeteer_pool'; // eslint-disable-line import/no-duplicates
import { BASIC_CRAWLER_TIMEOUT_MULTIPLIER } from '../constants';
import { gotoExtended } from '../puppeteer_utils';
import { openSessionPool } from '../session_pool/session_pool'; // eslint-disable-line import/no-duplicates
import { addTimeoutToPromise } from '../utils';
import BasicCrawler from './basic_crawler'; // eslint-disable-line import/no-duplicates
import defaultLog from '../utils_log';

// TYPE IMPORTS
/* eslint-disable no-unused-vars,import/named,import/no-duplicates,import/order */
import { Browser, Page as PuppeteerPage, Response as PuppeteerResponse } from 'puppeteer';
import { HandleFailedRequest } from './basic_crawler';
import { PuppeteerPoolOptions, LaunchPuppeteerFunction } from '../puppeteer_pool';
import Request from '../request'; // eslint-disable-line no-unused-vars
import { RequestList } from '../request_list'; // eslint-disable-line no-unused-vars
import { RequestQueue } from '../request_queue'; // eslint-disable-line no-unused-vars
import AutoscaledPool, { AutoscaledPoolOptions } from '../autoscaling/autoscaled_pool'; // eslint-disable-line no-unused-vars,import/named
import { LaunchPuppeteerOptions } from '../puppeteer'; // eslint-disable-line no-unused-vars,import/named
import { Session } from '../session_pool/session'; // eslint-disable-line no-unused-vars
import { SessionPoolOptions } from '../session_pool/session_pool';
import { ProxyConfiguration, ProxyInfo } from '../proxy_configuration';
// eslint-enable-line import/no-duplicates

/**
 * @typedef PuppeteerCrawlerOptions
 * @property {PuppeteerHandlePage} handlePageFunction
 *   Function that is called to process each request.
 *   It is passed an object with the following fields:
 *
 * ```
 * {
 *   request: Request,
 *   response: Response,
 *   page: Page,
 *   puppeteerPool: PuppeteerPool,
 *   autoscaledPool: AutoscaledPool,
 *   session: Session,
 *   proxyInfo: ProxyInfo,
 * }
 * ```
 *
 *   `request` is an instance of the {@link Request} object with details about the URL to open, HTTP method etc.
 *   `page` is an instance of the `Puppeteer`
 *   [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page)
 *   `response` is an instance of the `Puppeteer`
 *   [`Response`](https://pptr.dev/#?product=Puppeteer&show=api-class-response),
 *   which is the main resource response as returned by `page.goto(request.url)`.
 *   `puppeteerPool` is an instance of the {@link PuppeteerPool} used by this `PuppeteerCrawler`.
 *
 *   The function must return a promise, which is then awaited by the crawler.
 *
 *   If the function throws an exception, the crawler will try to re-crawl the
 *   request later, up to `option.maxRequestRetries` times.
 *   If all the retries fail, the crawler calls the function
 *   provided to the `handleFailedRequestFunction` parameter.
 *   To make this work, you should **always**
 *   let your function throw exceptions rather than catch them.
 *   The exceptions are logged to the request using the
 *   {@link Request#pushErrorMessage} function.
 * @property {RequestList} [requestList]
 *   Static list of URLs to be processed.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @property {RequestQueue} [requestQueue]
 *   Dynamic queue of URLs to be processed. This is useful for recursive crawling of websites.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @property {number} [handlePageTimeoutSecs=60]
 *   Timeout in which the function passed as `handlePageFunction` needs to finish, in seconds.
 * @property {PuppeteerGoto} [gotoFunction]
 *   Overrides the function that opens the page in Puppeteer. The function should return the result of Puppeteer's
 *   [page.goto()](https://pptr.dev/#?product=Puppeteer&show=api-pagegotourl-options) function,
 *   i.e. a `Promise` resolving to the [Response](https://pptr.dev/#?product=Puppeteer&show=api-class-httpresponse) object.
 *
 *   This is useful if you need to select different criteria to determine navigation success and also to do any
 *   pre or post processing such as injecting cookies into the page.
 *
 *   Note that a single page object is only used to process a single request and it is closed afterwards.
 *
 *   By default, the function invokes {@link puppeteer#gotoExtended} with a timeout of 60 seconds.
 * @property {number} [gotoTimeoutSecs=60]
 *   Timeout in which page navigation needs to finish, in seconds. When `gotoFunction()` is used and thus the default
 *   function is overridden, this timeout will not be used and needs to be configured in the new `gotoFunction()`.
 * @property {HandleFailedRequest} [handleFailedRequestFunction]
 *   A function to handle requests that failed more than `option.maxRequestRetries` times.
 *
 *   The function receives the following object as an argument:
 * ```
 * {
 *   request: Request,
 *   error: Error,
 * }
 * ```
 *   Where the {@link Request} instance corresponds to the failed request, and the `Error` instance
 *   represents the last error thrown during processing of the request.
 * @property {number} [maxRequestRetries=3]
 *    Indicates how many times the request is retried if either `handlePageFunction()` or `gotoFunction()` fails.
 * @property {number} [maxRequestsPerCrawl]
 *   Maximum number of pages that the crawler will open. The crawl will stop when this limit is reached.
 *   Always set this value in order to prevent infinite loops in misconfigured crawlers.
 *   Note that in cases of parallel crawling, the actual number of pages visited might be slightly higher than this value.
 * @property {PuppeteerPoolOptions} [puppeteerPoolOptions]
 *   Custom options passed to the underlying {@link PuppeteerPool} constructor.
 *   You can tweak those to fine-tune browser management.
 * @property {LaunchPuppeteerFunction} [launchPuppeteerFunction]
 *   Overrides the default function to launch a new Puppeteer instance.
 *   Shortcut to the corresponding {@link PuppeteerPool} option.
 *   See source code on
 *   [GitHub](https://github.com/apify/apify-js/blob/master/src/puppeteer_pool.js#L28)
 *   for default behavior.
 * @property {LaunchPuppeteerOptions} [launchPuppeteerOptions]
 *   Options used by {@link Apify#launchPuppeteer} to start new Puppeteer instances.
 *   Shortcut to the corresponding {@link PuppeteerPool} option.
 * @property {AutoscaledPoolOptions} [autoscaledPoolOptions]
 *   Custom options passed to the underlying {@link AutoscaledPool} instance constructor.
 *   Note that the `runTaskFunction`, `isTaskReadyFunction` and `isFinishedFunction` options
 *   are provided by `PuppeteerCrawler` and should not be overridden.
 * @property {number} [minConcurrency=1]
 *   Sets the minimum concurrency (parallelism) for the crawl. Shortcut to the
 *   corresponding {@link AutoscaledPoolOptions.minConcurrency} option.
 *
 *   *WARNING:* If you set this value too high with respect to the available system memory and CPU,
 *   your crawler will run extremely slow or crash. If you're not sure, just keep the default value
 *   and the concurrency will scale up automatically.
 * @property {number} [maxConcurrency=1000]
 *   Sets the maximum concurrency (parallelism) for the crawl. Shortcut to the
 *   corresponding {@link AutoscaledPoolOptions.maxConcurrency} option.
 * @property {boolean} [useSessionPool=false]
 *   If set to true Crawler will automatically use Session Pool. It will automatically retire
 *   sessions on 403, 401 and 429 status codes. It also marks Session as bad after a request timeout.
 * @property {SessionPoolOptions} [sessionPoolOptions]
 *   Custom options passed to the underlying {@link SessionPool} constructor.
 * @property {boolean} [persistCookiesPerSession=false]
 *   Automatically saves cookies to Session. Works only if Session Pool is used.
 * @property {ProxyConfiguration} [proxyConfiguration]
 *   If set, `PuppeteerCrawler` will be configured for all connections to use
 *   [Apify Proxy](https://my.apify.com/proxy) or your own Proxy URLs provided and rotated according to the configuration.
 *   For more information, see the [documentation](https://docs.apify.com/proxy).
 */

/**
 * Provides a simple framework for parallel crawling of web pages
 * using headless Chrome with [Puppeteer](https://github.com/puppeteer/puppeteer).
 * The URLs to crawl are fed either from a static list of URLs
 * or from a dynamic queue of URLs enabling recursive crawling of websites.
 *
 * Since `PuppeteerCrawler` uses headless Chrome to download web pages and extract data,
 * it is useful for crawling of websites that require to execute JavaScript.
 * If the target website doesn't need JavaScript, consider using {@link CheerioCrawler},
 * which downloads the pages using raw HTTP requests and is about 10x faster.
 *
 * The source URLs are represented using {@link Request} objects that are fed from
 * {@link RequestList} or {@link RequestQueue} instances provided by the {@link PuppeteerCrawlerOptions.requestList}
 * or {@link PuppeteerCrawlerOptions.requestQueue} constructor options, respectively.
 *
 * If both {@link PuppeteerCrawlerOptions.requestList} and {@link PuppeteerCrawlerOptions.requestQueue} are used,
 * the instance first processes URLs from the {@link RequestList} and automatically enqueues all of them
 * to {@link RequestQueue} before it starts their processing. This ensures that a single URL is not crawled multiple times.
 *
 * The crawler finishes when there are no more {@link Request} objects to crawl.
 *
 * `PuppeteerCrawler` opens a new Chrome page (i.e. tab) for each {@link Request} object to crawl
 * and then calls the function provided by user as the {@link PuppeteerCrawlerOptions.handlePageFunction} option.
 *
 * New pages are only opened when there is enough free CPU and memory available,
 * using the functionality provided by the {@link AutoscaledPool} class.
 * All {@link AutoscaledPool} configuration options can be passed to the {@link PuppeteerCrawlerOptions.autoscaledPoolOptions}
 * parameter of the `PuppeteerCrawler` constructor. For user convenience, the `minConcurrency` and `maxConcurrency`
 * {@link AutoscaledPoolOptions} are available directly in the `PuppeteerCrawler` constructor.
 *
 * Note that the pool of Puppeteer instances is internally managed by the {@link PuppeteerPool} class.
 * Many constructor options such as {@link PuppeteerPoolOptions.maxOpenPagesPerInstance} or
 * {@link PuppeteerPoolOptions.launchPuppeteerFunction} are passed directly to the {@link PuppeteerPool} constructor.
 *
 * **Example usage:**
 *
 * ```javascript
 * const crawler = new Apify.PuppeteerCrawler({
 *     requestList,
 *     handlePageFunction: async ({ page, request }) => {
 *         // This function is called to extract data from a single web page
 *         // 'page' is an instance of Puppeteer.Page with page.goto(request.url) already called
 *         // 'request' is an instance of Request class with information about the page to load
 *         await Apify.pushData({
 *             title: await page.title(),
 *             url: request.url,
 *             succeeded: true,
 *         })
 *     },
 *     handleFailedRequestFunction: async ({ request }) => {
 *         // This function is called when the crawling of a request failed too many times
 *         await Apify.pushData({
 *             url: request.url,
 *             succeeded: false,
 *             errors: request.errorMessages,
 *         })
 *     },
 * });
 *
 * await crawler.run();
 * ```
 * @property {AutoscaledPool} autoscaledPool
 *  A reference to the underlying {@link AutoscaledPool} class that manages the concurrency of the crawler.
 *  Note that this property is only initialized after calling the {@link PuppeteerCrawler#run} function.
 *  You can use it to change the concurrency settings on the fly,
 *  to pause the crawler by calling {@link AutoscaledPool#pause}
 *  or to abort it by calling {@link AutoscaledPool#abort}.
 *
 */
class PuppeteerCrawler {
    /**
     * @param {PuppeteerCrawlerOptions} options
     * All `PuppeteerCrawler` parameters are passed via an options object.
     */
    constructor(options) {
        const {
            handlePageFunction,
            gotoFunction = this._defaultGotoFunction,
            handlePageTimeoutSecs = 60,
            gotoTimeoutSecs = 60,

            // AutoscaledPool shorthands
            maxConcurrency,
            minConcurrency,

            // BasicCrawler options
            requestList,
            requestQueue,
            maxRequestRetries,
            maxRequestsPerCrawl,
            handleFailedRequestFunction = this._defaultHandleFailedRequestFunction.bind(this),
            autoscaledPoolOptions,

            // PuppeteerPool options and shorthands
            puppeteerPoolOptions,
            launchPuppeteerFunction,
            launchPuppeteerOptions,

            sessionPoolOptions = {},
            persistCookiesPerSession = false,
            useSessionPool = false,
            proxyConfiguration,
        } = options;

        checkParamOrThrow(handlePageFunction, 'options.handlePageFunction', 'Function');
        checkParamOrThrow(handlePageTimeoutSecs, 'options.handlePageTimeoutSecs', 'Number');
        checkParamOrThrow(handleFailedRequestFunction, 'options.handleFailedRequestFunction', 'Function');
        checkParamOrThrow(gotoFunction, 'options.gotoFunction', 'Function');
        checkParamOrThrow(gotoTimeoutSecs, 'options.gotoTimeoutSecs', 'Number');
        checkParamOrThrow(puppeteerPoolOptions, 'options.puppeteerPoolOptions', 'Maybe Object');
        checkParamOrThrow(useSessionPool, 'options.useSessionPool', 'Boolean');
        checkParamOrThrow(sessionPoolOptions, 'options.sessionPoolOptions', 'Object');
        checkParamOrThrow(persistCookiesPerSession, 'options.persistCookiesPerSession', 'Boolean');
        checkParamPrototypeOrThrow(proxyConfiguration, 'options.proxyConfiguration', ProxyConfiguration, 'ProxyConfiguration', true);

        if (proxyConfiguration && (launchPuppeteerOptions && launchPuppeteerOptions.proxyUrl)) {
            throw new Error('It is not possible to combine "options.proxyConfiguration" together with '
                + 'custom "proxyUrl" option from "options.launchPuppeteerOptions".');
        }

        this.log = defaultLog.child({ prefix: 'PuppeteerCrawler' });

        if (options.gotoTimeoutSecs && options.gotoFunction) {
            this.log.warning('You are using gotoTimeoutSecs with a custom gotoFunction. '
                + 'The timeout value will not be used. With a custom gotoFunction, you need to set the timeout in the function itself.');
        }

        this.handlePageFunction = handlePageFunction;
        this.gotoFunction = gotoFunction;

        this.handlePageTimeoutMillis = handlePageTimeoutSecs * 1000;
        this.gotoTimeoutMillis = gotoTimeoutSecs * 1000;

        this.puppeteerPoolOptions = {
            ...puppeteerPoolOptions,
            launchPuppeteerFunction,
            launchPuppeteerOptions,
        };

        this.puppeteerPool = null; // Constructed when .run()
        this.useSessionPool = useSessionPool;
        this.sessionPoolOptions = {
            ...sessionPoolOptions,
            log: this.log,
        };
        this.persistCookiesPerSession = persistCookiesPerSession;
        this.proxyConfiguration = proxyConfiguration;

        /** @ignore */
        this.basicCrawler = new BasicCrawler({
            // Basic crawler options.
            requestList,
            requestQueue,
            maxRequestRetries,
            maxRequestsPerCrawl,
            handleRequestFunction: (...args) => this._handleRequestFunction(...args),
            handleRequestTimeoutSecs: handlePageTimeoutSecs * BASIC_CRAWLER_TIMEOUT_MULTIPLIER,
            handleFailedRequestFunction,

            // Autoscaled pool options.
            maxConcurrency,
            minConcurrency,
            autoscaledPoolOptions,

            // log
            log: this.log,
        });
    }

    /**
     * Runs the crawler. Returns promise that gets resolved once all the requests got processed.
     *
     * @return {Promise<void>}
     */
    async run() {
        if (this.isRunningPromise) return this.isRunningPromise;

        if (this.useSessionPool) {
            this.sessionPool = await openSessionPool(this.sessionPoolOptions);
            this.puppeteerPoolOptions.sessionPool = this.sessionPool;
        }

        if (this.proxyConfiguration) {
            this.puppeteerPoolOptions.proxyConfiguration = this.proxyConfiguration;
        }

        this.puppeteerPoolOptions.log = this.log;
        this.puppeteerPool = new PuppeteerPool(this.puppeteerPoolOptions);
        try {
            this.isRunningPromise = this.basicCrawler.run();
            this.autoscaledPool = this.basicCrawler.autoscaledPool;

            await this.isRunningPromise;
        } finally {
            if (this.useSessionPool) {
                await this.sessionPool.teardown();
            }
            await this.puppeteerPool.destroy();
        }
    }

    /**
     * Wrapper around handlePageFunction that opens and closes pages etc.
     *
     * @param {Object} options
     * @param {Request} options.request
     * @param {AutoscaledPool} options.autoscaledPool
     * @ignore
     */
    async _handleRequestFunction({ request, autoscaledPool }) {
        let session;
        let proxyInfo;
        const page = await this.puppeteerPool.newPage();

        // eslint-disable-next-line no-underscore-dangle
        const browserInstance = this.puppeteerPool._getBrowserInstance(page);
        if (this.sessionPool) {
            // eslint-disable-next-line prefer-destructuring
            session = browserInstance.session;

            // setting cookies to page
            if (this.persistCookiesPerSession) {
                await page.setCookie(...session.getPuppeteerCookies(request.url));
            }
        }

        if (this.proxyConfiguration) {
            // eslint-disable-next-line prefer-destructuring
            proxyInfo = browserInstance.proxyInfo;
        }


        try {
            const response = await this.gotoFunction({ page, request, autoscaledPool, puppeteerPool: this.puppeteerPool, session, proxyInfo });
            await this.puppeteerPool.serveLiveViewSnapshot(page);
            request.loadedUrl = page.url();

            // save cookies
            if (this.persistCookiesPerSession) {
                const cookies = await page.cookies(request.loadedUrl);
                session.setPuppeteerCookies(cookies, request.loadedUrl);
            }

            await addTimeoutToPromise(
                this.handlePageFunction({ page, request, autoscaledPool, puppeteerPool: this.puppeteerPool, response, session, proxyInfo }),
                this.handlePageTimeoutMillis,
                `handlePageFunction timed out after ${this.handlePageTimeoutMillis / 1000} seconds.`,
            );

            if (session) session.markGood();
        } finally {
            await this.puppeteerPool.recyclePage(page);
        }
    }

    /**
     * @param {Object} options
     * @param {PuppeteerPage} options.page
     * @param {Request} options.request
     * @return {Promise<PuppeteerResponse>}
     * @ignore
     */
    async _defaultGotoFunction({ page, request }) {
        return gotoExtended(page, request, { timeout: this.gotoTimeoutMillis });
    }

    /**
     * @param {Object} options
     * @param {Error} options.error
     * @param {Request} options.request
     * @return {Promise<void>}
     * @ignore
     */
    async _defaultHandleFailedRequestFunction({ error, request }) { // eslint-disable-line class-methods-use-this
        const details = _.pick(request, 'id', 'url', 'method', 'uniqueKey');
        this.log.exception(error, 'Request failed and reached maximum retries', details);
    }
}

export default PuppeteerCrawler;

/**
 * @typedef PuppeteerHandlePageInputs
 * @property {Request} request
 *   An instance of the {@link Request} object with details about the URL to open, HTTP method etc.
 * @property {PuppeteerResponse} response An instance of the Puppeteer
 *   [`Response`](https://pptr.dev/#?product=Puppeteer&show=api-class-response),
 *   which is the main resource response as returned by `page.goto(request.url)`.
 * @property {PuppeteerPage} page is an instance of the Puppeteer
 *   [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page)
 * @property {PuppeteerPool} puppeteerPool
 *   An instance of the {@link PuppeteerPool} used by this `PuppeteerCrawler`.
 * @property {AutoscaledPool} autoscaledPool
 *   A reference to the underlying {@link AutoscaledPool} class that manages the concurrency of the crawler.
 *   Note that this property is only initialized after calling the {@link PuppeteerCrawler#run} function.
 *   You can use it to change the concurrency settings on the fly,
 *   to pause the crawler by calling {@link AutoscaledPool#pause}
 *   or to abort it by calling {@link AutoscaledPool#abort}.
 * @property {Session} [session]
 * @property {ProxyInfo} [proxyInfo]
 */

/**
 * @callback PuppeteerHandlePage
 * @param {PuppeteerHandlePageInputs} inputs Arguments passed to this callback.
 * @return {Promise<void>}
 */

/**
 * @typedef PuppeteerGotoInputs
 * @property {PuppeteerPage} page is an instance of the Puppeteer
 *   [`Page`](https://pptr.dev/#?product=Puppeteer&show=api-class-page)
 * @property {Request} request
 *   An instance of the {@link Request} object with details about the URL to open, HTTP method etc.
 * @property {AutoscaledPool} autoscaledPool An instance of the `AutoscaledPool`.
 * @property {PuppeteerPool} puppeteerPool An instance of the {@link PuppeteerPool} used by this `PuppeteerCrawler`.
 * @property {Session} [session] `Session` object for this request.
 * @property {ProxyInfo} [proxyInfo]
 */

/**
 * @callback PuppeteerGoto
 * @param {PuppeteerGotoInputs} inputs Arguments passed to this callback.
 * @return {Promise<(PuppeteerResponse | null)>} An instance of the Puppeteer
 *   [`Response`](https://pptr.dev/#?product=Puppeteer&show=api-class-response),
 *   which is the main resource response as returned by `page.goto(request.url)`.
 */

/**
 * @callback LaunchPuppeteer
 * @param {LaunchPuppeteerOptions} inputs Arguments passed to this callback.
 * @return {Promise<Browser>} Promise that resolves to Puppeteer's `Browser` instance.
 *   This might be obtained by calling
 *   [puppeteer.launch()](https://pptr.dev/#?product=Puppeteer&version=v2.0.0&show=api-puppeteerlaunchoptions)
 *   directly, or by delegating to
 *   {@link Apify#launchPuppeteer}.
 */
