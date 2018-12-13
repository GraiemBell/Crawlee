import { checkParamOrThrow } from 'apify-client/build/utils';
import _ from 'underscore';
import log from 'apify-shared/log';
import { checkParamPrototypeOrThrow } from 'apify-shared/utilities';
import AutoscaledPool from './autoscaling/autoscaled_pool';
import RequestList from './request_list';
import { RequestQueue, RequestQueueLocal } from './request_queue';
import { apifyClient } from './utils';

const DEFAULT_OPTIONS = {
    maxRequestRetries: 3,
    handleFailedRequestFunction: ({ request }) => {
        const details = _.pick(request, 'id', 'url', 'method', 'uniqueKey');
        log.error('BasicCrawler: Request failed and reached maximum retries', details);
    },
    autoscaledPoolOptions: {},
};

/**
 * Provides a simple framework for parallel crawling of web pages,
 * whose URLs are fed either from a static list
 * or from a dynamic queue of URLs.
 *
 * `BasicCrawler` invokes the user-provided [`handleRequestFunction()`](#new_BasicCrawler_new)
 * for each {@link Request} object, which represents a single URL to crawl.
 * The {@link Request} objects are fed from the {@link RequestList} or the {@link RequestQueue}
 * instances provided by the [`requestList`](#new_BasicCrawler_new) or [`requestQueue`](#new_BasicCrawler_new)
 * constructor options, respectively.
 *
 * If both [`requestList`](#new_BasicCrawler_new) and [`requestQueue`](#new_BasicCrawler_new) options are used,
 * the instance first processes URLs from the {@link RequestList} and automatically enqueues all of them
 * to {@link RequestQueue} before it starts their processing. This ensures that a single URL is not crawled multiple times.
 *
 * The crawler finishes if there are no more {@link Request} objects to crawl.
 *
 * New requests are only dispatched when there is enough free CPU and memory available,
 * using the functionality provided by the {@link AutoscaledPool} class.
 * All {@link AutoscaledPool} configuration options can be passed to the `autoscaledPoolOptions`
 * parameter of the `BasicCrawler` constructor. For user convenience, the `minConcurrency` and `maxConcurrency`
 * {@link AutoscaledPool} options are available directly in the `BasicCrawler` constructor.
 *
 * **Example usage:**
 *
 * ```javascript
 * const rp = require('request-promise-native');
 *
 * // Prepare a list of URLs to crawl
 * const requestList = new Apify.RequestList({
 *   sources: [
 *       { url: 'http://www.example.com/page-1' },
 *       { url: 'http://www.example.com/page-2' },
 *   ],
 * });
 * await requestList.initialize();
 *
 * // Crawl the URLs
 * const crawler = new Apify.BasicCrawler({
 *     requestList,
 *     handleRequestFunction: async ({ request }) => {
 *         // 'request' contains an instance of the Request class
 *         // Here we simply fetch the HTML of the page and store it to a dataset
 *         await Apify.pushData({
 *             url: request.url,
 *             html: await rp(request.url),
 *         })
 *     },
 * });
 *
 * await crawler.run();
 * ```
 *
 * @param {Object} options All `BasicCrawler` parameters are passed
 *   via an options object with the following keys:
 * @param {Function} options.handleRequestFunction
 *   User-provided function that performs the logic of the crawler. It is called for each URL to crawl.
 *
 *   The function receives the following object as an argument:
 * ```
 * {
 *   request: Request
 * }
 * ```
 *   where the {@link Request} instance represents the URL to crawl.
 *   The function must return a promise.
 * @param {RequestList} options.requestList
 *   Static list of URLs to be processed.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @param {RequestQueue} options.requestQueue
 *   Dynamic queue of URLs to be processed. This is useful for recursive crawling of websites.
 *   Either `requestList` or `requestQueue` option must be provided (or both).
 * @param {Function} [options.handleFailedRequestFunction]
 *   A function to handle requests that failed more than `option.maxRequestRetries` times.
 *
 *   The function receives the following object as an argument:
 * ```
 * {
 *   request: Request,
 *   error: Error,
 * }
 * ```
 *   where the {@link Request} instance corresponds to the failed request, and the `Error` instance
 *   represents the last error thrown during processing of the request.
 *
 *   See
 *   <a href="https://github.com/apifytech/apify-js/blob/master/src/basic_crawler.js#L11" target="_blank">source code</a>
 *   for the default implementation of this function.
 * @param {Number} [options.maxRequestRetries=3]
 *   Indicates how many times the request is retried if [`handleRequestFunction()`](#new_BasicCrawler_new) fails.
 * @param {Number} [options.maxRequestsPerCrawl]
 *   Maximum number of pages that the crawler will open. The crawl will stop when this limit is reached.
 *   Always set this value in order to prevent infinite loops in misconfigured crawlers.
 *   Note that in cases of parallel crawling, the actual number of pages visited might be slightly higher than this value.
 * @param {Object} [options.autoscaledPoolOptions]
 *   Custom options passed to the underlying {@link AutoscaledPool} constructor.
 *   Note that the `runTaskFunction`, `isTaskReadyFunction` and `isFinishedFunction` options
 *   are provided by `BasicCrawler` and cannot be overridden.
 * @param {Object} [options.minConcurrency=1]
 *   Sets the minimum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
 *
 *   *WARNING:* If you set this value too high with respect to the available system memory and CPU, your crawler will run extremely slow or crash.
 *   If you're not sure, just keep the default value and the concurrency will scale up automatically.
 * @param {Object} [options.maxConcurrency=1000]
 *   Sets the maximum concurrency (parallelism) for the crawl. Shortcut to the corresponding {@link AutoscaledPool} option.
 */
class BasicCrawler {
    constructor(options) {
        const {
            requestList,
            requestQueue,
            handleRequestFunction,
            handleFailedRequestFunction,
            maxRequestRetries,
            maxRequestsPerCrawl,
            autoscaledPoolOptions,

            // AutoscaledPool shorthands
            minConcurrency,
            maxConcurrency,
        } = _.defaults({}, options, DEFAULT_OPTIONS);

        checkParamPrototypeOrThrow(requestList, 'options.requestList', RequestList, 'Apify.RequestList', true);
        checkParamPrototypeOrThrow(requestQueue, 'options.requestQueue', [RequestQueue, RequestQueueLocal], 'Apify.RequestQueue', true);
        checkParamOrThrow(handleRequestFunction, 'options.handleRequestFunction', 'Function');
        checkParamOrThrow(handleFailedRequestFunction, 'options.handleFailedRequestFunction', 'Function');
        checkParamOrThrow(maxRequestRetries, 'options.maxRequestRetries', 'Number');
        checkParamOrThrow(maxRequestsPerCrawl, 'options.maxRequestsPerCrawl', 'Maybe Number');
        checkParamOrThrow(autoscaledPoolOptions, 'options.autoscaledPoolOptions', 'Object');

        if (!requestList && !requestQueue) {
            throw new Error('At least one of the parameters "options.requestList" and "options.requestQueue" must be provided!');
        }

        this.requestList = requestList;
        this.requestQueue = requestQueue;
        this.handleRequestFunction = handleRequestFunction;
        this.handleFailedRequestFunction = handleFailedRequestFunction;
        this.maxRequestRetries = maxRequestRetries;
        this.handledRequestsCount = 0;

        const isMaxPagesExceeded = () => maxRequestsPerCrawl && maxRequestsPerCrawl <= this.handledRequestsCount;

        const { isFinishedFunction } = autoscaledPoolOptions;
        const basicCrawlerAutoscaledPoolConfiguration = {
            minConcurrency,
            maxConcurrency,
            runTaskFunction: async () => {
                if (!this.isRunning) return null;

                return this._runTaskFunction();
            },
            isTaskReadyFunction: async () => {
                if (isMaxPagesExceeded() || !this.isRunning) return false;

                return this._isTaskReadyFunction();
            },
            isFinishedFunction: async () => {
                if (isMaxPagesExceeded() || !this.isRunning) return true;

                return isFinishedFunction
                    ? isFinishedFunction()
                    : this._defaultIsFinishedFunction();
            },
        };

        this.autoscaledPoolOptions = _.defaults({}, basicCrawlerAutoscaledPoolConfiguration, autoscaledPoolOptions);
    }

    /**
     * Runs the crawler. Returns a promise that gets resolved once all the requests are processed.
     *
     * @return {Promise}
     */
    async run() {
        if (this.isRunning) return this.isRunningPromise;

        await this._loadHandledRequestCount();
        this.autoscaledPool = new AutoscaledPool(this.autoscaledPoolOptions);
        this.isRunning = true;
        this.rejectOnAbortPromise = new Promise((r, reject) => { this.rejectOnAbort = reject; });
        this.isRunningPromise = this.autoscaledPool.run();
        try {
            await this.isRunningPromise;
            this.isRunning = false;
        } catch (err) {
            this.isRunning = false; // Doing this before rejecting to make sure it's set when error handlers fire.
            this.rejectOnAbort(err);
        }
    }

    /**
     * Aborts the crawler by preventing additional requests and terminating the running ones.
     *
     * @return {Promise}
     */
    async abort() {
        this.isRunning = false;
        await this.autoscaledPool.abort();
        this.rejectOnAbort(new Error('BasicCrawler: .abort() function has been called. Aborting the crawler.'));
    }

    /**
     * Fetches request from either RequestList or RequestQueue. If request comes from a RequestList
     * and RequestQueue is present then enqueues it to the queue first.
     *
     * @ignore
     */
    async _fetchNextRequest() {
        if (!this.requestList) return this.requestQueue.fetchNextRequest();
        const request = await this.requestList.fetchNextRequest();
        if (!this.requestQueue) return request;
        if (!request) return this.requestQueue.fetchNextRequest();

        try {
            await this.requestQueue.addRequest(request, { forefront: true });
        } catch (err) {
            // If requestQueue.addRequest() fails here then we must reclaim it back to
            // the RequestList because probably it's not yet in the queue!
            log.exception(err, 'RequestQueue.addRequest() failed, reclaiming request back to the list', { request });
            await this.requestList.reclaimRequest(request);
            return null;
        }
        const [nextRequest] = await Promise.all([
            this.requestQueue.fetchNextRequest(),
            this.requestList.markRequestHandled(request),
        ]);
        return nextRequest;
    }

    /**
     * Wrapper around handleRequestFunction that fetches requests from RequestList/RequestQueue
     * then retries them in a case of an error, etc.
     *
     * @ignore
     */
    async _runTaskFunction() {
        const source = this.requestQueue || this.requestList;

        const request = await this._fetchNextRequest();
        if (!request) return;

        try {
            // rejectOnAbortPromise rejects when .abort() is called or AutoscaledPool throws.
            // All running tasks are therefore terminated with an error to be reclaimed and retried.
            await Promise.race([this.handleRequestFunction({ request }), this.rejectOnAbortPromise]);
            await source.markRequestHandled(request);
            this.handledRequestsCount++;
        } catch (err) {
            try {
                // TODO Errors thrown from within the error handler will in most cases terminate
                // the crawler because runTaskFunction errors kill autoscaled pool
                // which is correct, since in this case, RequestQueue is probably in an unknown
                // state. However, it's also troublesome when RequestQueue is overloaded
                // since it may actually cause the crawlers to crash.
                await this._requestFunctionErrorHandler(err, request, source);
            } catch (secondaryError) {
                log.exception(secondaryError, 'BasicCrawler: runTaskFunction error handler threw an exception. '
                    + 'This places the RequestQueue into an unknown state and crawling will be terminated. '
                    + 'This most likely happened due to RequestQueue being overloaded and unable to handle '
                    + 'Request updates even after exponential backoff. Try limiting the concurrency '
                    + 'of the run by using the maxConcurrency option.');
                throw secondaryError;
            }
        }
    }

    /**
     * Returns true if either RequestList or RequestQueue have a request ready for processing.
     *
     * @ignore
     */
    async _isTaskReadyFunction() {
        // First check RequestList, since it's only in memory.
        const isRequestListEmpty = this.requestList ? (await this.requestList.isEmpty()) : true;
        // If RequestList is not empty, task is ready, no reason to check RequestQueue.
        if (!isRequestListEmpty) return true;
        // If RequestQueue is not empty, task is ready, return true, otherwise false.
        return this.requestQueue ? !(await this.requestQueue.isEmpty()) : false;
    }

    /**
     * Returns true if both RequestList and RequestQueue have all requests finished.
     *
     * @ignore
     */
    async _defaultIsFinishedFunction() {
        const [
            isRequestListFinished,
            isRequestQueueFinished,
        ] = await Promise.all([
            this.requestList ? this.requestList.isFinished() : true,
            this.requestQueue ? this.requestQueue.isFinished() : true,
        ]);
        // If both are finished, return true, otherwise return false.
        return isRequestListFinished && isRequestQueueFinished;
    }

    /**
     * Handles errors thrown by user provided handleRequestFunction()
     * @param {Error} error
     * @param {Request} request
     * @param {RequestList|RequestQueue} source
     * @return {Boolean} willBeRetried
     * @ignore
     */
    async _requestFunctionErrorHandler(error, request, source) {
        // Handles case where the crawler was aborted.
        // All running requests are reclaimed and will be retried.
        if (!this.isRunning) return source.reclaimRequest(request);

        // If we got here, it means we actually want to process the error.
        request.pushErrorMessage(error);

        // Reclaim and retry request if flagged as retriable and retryCount is not exceeded.
        if (!request.noRetry && request.retryCount < this.maxRequestRetries) {
            request.retryCount++;
            log.exception(error, 'BasicCrawler: handleRequestFunction failed, reclaiming failed request back to the list or queue', { // eslint-disable-line max-len
                url: request.url,
                retryCount: request.retryCount,
            });
            return source.reclaimRequest(request);
        }

        // If we get here, the request is either not retriable
        // or failed more than retryCount times and will not be retried anymore.
        // Mark the request as failed and do not retry.
        this.handledRequestsCount++;
        await source.markRequestHandled(request);
        return this.handleFailedRequestFunction({ request, error }); // This function prints an error message.
    }

    /**
     * Updates handledRequestsCount from possibly stored counts,
     * usually after worker migration. Since one of the stores
     * needs to have priority when both are present,
     * it is the request queue, because generally, the request
     * list will first be dumped into the queue and then left
     * empty.
     *
     * @return {Promise}
     * @ignore
     */
    async _loadHandledRequestCount() {
        if (this.requestQueue) {
            this.handledRequestsCount = await this.requestQueue.handledCount();
        } else if (this.requestList) {
            this.handledRequestsCount = this.requestList.handledCount();
        }
    }
}

export default BasicCrawler;
