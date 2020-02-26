/// <reference types="node" />
import { main } from "./actor";
import { getEnv } from "./actor";
import { call } from "./actor";
import { callTask } from "./actor";
import { metamorph } from "./actor";
import { getMemoryInfo } from "./utils";
import { getApifyProxyUrl } from "./actor";
import { isAtHome } from "./utils";
import { apifyClient } from "./utils";
import { addWebhook } from "./actor";
import AutoscaledPool from "./autoscaling/autoscaled_pool";
import BasicCrawler from "./crawlers/basic_crawler";
import CheerioCrawler from "./crawlers/cheerio_crawler";
import { pushData } from "./dataset";
import { openDataset } from "./dataset";
import events from "./events";
import { initializeEvents } from "./events";
import { stopEvents } from "./events";
import { getValue } from "./key_value_store";
import { setValue } from "./key_value_store";
import { getInput } from "./key_value_store";
import { openKeyValueStore } from "./key_value_store";
import { launchPuppeteer } from "./puppeteer";
import PuppeteerPool from "./puppeteer_pool";
import PuppeteerCrawler from "./crawlers/puppeteer_crawler";
import PseudoUrl from "./pseudo_url";
import Request from "./request";
import { RequestList } from "./request_list";
import { openRequestList } from "./request_list";
import { openRequestQueue } from "./request_queue";
import { openSessionPool } from "./session_pool/session_pool";
import LiveViewServer from "./live_view/live_view_server";
import { Session } from "./session_pool/session";
declare const exportedUtils: {
    isDocker: (forceReset: boolean) => Promise<boolean>;
    sleep: (millis: number) => Promise<void>;
    downloadListOfUrls: ({ url, encoding, urlRegExp }: {
        url: string;
        encoding?: string;
        urlRegExp?: RegExp;
    }) => Promise<string[]>;
    extractUrls: ({ string, urlRegExp }: {
        string: string;
        urlRegExp?: RegExp;
    }) => string[];
    getRandomUserAgent: () => string;
    htmlToText: (html: string | CheerioStatic) => string;
    URL_NO_COMMAS_REGEX: RegExp;
    URL_WITH_COMMAS_REGEX: RegExp;
    createRequestDebugInfo: (request: Request | import("./request").RequestOptions, response?: import("http").IncomingMessage | import("puppeteer").Response | undefined, additionalFields?: Object | undefined) => any;
    parseContentTypeFromResponse: (response: import("http").IncomingMessage) => {
        type: string;
        charset: string;
    };
} & {
    puppeteer: {
        hideWebDriver: (page: import("puppeteer").Page) => Promise<void>;
        injectFile: (page: import("puppeteer").Page, filePath: string, options?: {
            surviveNavigations?: boolean;
        } | undefined) => Promise<any>;
        injectJQuery: (page: import("puppeteer").Page) => Promise<any>;
        injectUnderscore: (page: import("puppeteer").Page) => Promise<any>;
        enqueueRequestsFromClickableElements: (page: any, selector: any, purls: any, requestQueue: any, requestOpts?: {}) => Promise<any[]>;
        enqueueLinks: (...args: any[]) => Promise<import("./request_queue").QueueOperationInfo[] | undefined>;
        enqueueLinksByClickingElements: typeof import("./enqueue_links/click_elements").enqueueLinksByClickingElements;
        blockRequests: (page: import("puppeteer").Page, options?: {
            urlPatterns?: string[];
            extraUrlPatterns?: string[];
        } | undefined) => Promise<void>;
        blockResources: (page: any, resourceTypes?: string[]) => Promise<void>;
        cacheResponses: (page: import("puppeteer").Page, cache: Object, responseUrlRules: (string | RegExp)[]) => Promise<void>;
        compileScript: (scriptString: string, context?: Object) => Function;
        gotoExtended: (page: import("puppeteer").Page, request: Request, gotoOptions?: import("puppeteer").DirectNavigationOptions) => Promise<import("puppeteer").Response | null>;
        addInterceptRequestHandler: (page: import("puppeteer").Page, handler: import("./puppeteer_request_interception").InterceptHandler) => Promise<void>;
        removeInterceptRequestHandler: (page: import("puppeteer").Page, handler: import("./puppeteer_request_interception").InterceptHandler) => Promise<void>;
        infiniteScroll: (page: import("puppeteer").Page, options?: {
            timeoutSecs?: number;
            waitForSecs?: number;
        } | undefined) => Promise<void>;
        saveSnapshot: (page: import("puppeteer").Page, options?: {
            key?: string;
            screenshotQuality?: number;
            saveScreenshot?: boolean;
            saveHtml?: boolean;
            keyValueStoreName?: string;
        } | undefined) => Promise<void>;
    };
    social: {
        emailsFromText: (text: string) => string[];
        emailsFromUrls: (urls: string[]) => string[];
        phonesFromText: (text: string) => string[];
        phonesFromUrls: (urls: string[]) => string[];
        parseHandlesFromHtml: (html: string, data?: Object) => import("./utils_social").SocialHandles;
        EMAIL_REGEX: RegExp;
        EMAIL_REGEX_GLOBAL: RegExp;
        LINKEDIN_REGEX: RegExp;
        LINKEDIN_REGEX_GLOBAL: RegExp;
        INSTAGRAM_REGEX: RegExp;
        INSTAGRAM_REGEX_GLOBAL: RegExp;
        TWITTER_REGEX: RegExp;
        TWITTER_REGEX_GLOBAL: RegExp;
        FACEBOOK_REGEX: RegExp;
        FACEBOOK_REGEX_GLOBAL: RegExp;
        YOUTUBE_REGEX: RegExp;
        YOUTUBE_REGEX_GLOBAL: RegExp;
    };
    log: typeof log;
    enqueueLinks: typeof enqueueLinks;
    requestAsBrowser: (options: import("./utils_request").RequestAsBrowserOptions) => Promise<import("stream").Readable | import("http").IncomingMessage>;
};
import log from "./utils_log";
import { enqueueLinks } from "./enqueue_links/enqueue_links";
export { main, getEnv, call, callTask, metamorph, getMemoryInfo, getApifyProxyUrl, isAtHome, apifyClient as client, addWebhook, AutoscaledPool, BasicCrawler, CheerioCrawler, pushData, openDataset, events, initializeEvents, stopEvents, getValue, setValue, getInput, openKeyValueStore, launchPuppeteer, PuppeteerPool, PuppeteerCrawler, PseudoUrl, Request, RequestList, openRequestList, openRequestQueue, openSessionPool, LiveViewServer, Session, exportedUtils as utils };

export { ApifyEnv, UserFunc } from "./actor";
export { AutoscaledPoolOptions } from "./autoscaling/autoscaled_pool";
export { SnapshotterOptions } from "./autoscaling/snapshotter";
export { SystemInfo, SystemStatusOptions } from "./autoscaling/system_status";
export { BasicCrawlerOptions, HandleRequest, HandleRequestInputs, HandleFailedRequest, HandleFailedRequestInput } from "./crawlers/basic_crawler";
export { CheerioCrawlerOptions, PrepareRequestInputs, PrepareRequest, CheerioHandlePageInputs, CheerioHandlePage } from "./crawlers/cheerio_crawler";
export { PuppeteerCrawlerOptions, PuppeteerHandlePageInputs, PuppeteerHandlePage, PuppeteerGotoInputs, PuppeteerGoto, LaunchPuppeteer } from "./crawlers/puppeteer_crawler";
export { DatasetContent, DatasetConsumer, DatasetMapper, DatasetReducer } from "./dataset";
export { RequestTransform } from "./enqueue_links/shared";
export { KeyConsumer } from "./key_value_store";
export { LaunchPuppeteerOptions } from "./puppeteer";
export { LaunchPuppeteerFunction, PuppeteerPoolOptions } from "./puppeteer_pool";
export { InterceptHandler } from "./puppeteer_request_interception";
export { RequestOptions } from "./request";
export { RequestListInput, SourceInput, RequestListOptions, RequestListState } from "./request_list";
export { QueueOperationInfo } from "./request_queue";
export { SessionState, SessionOptions } from "./session_pool/session";
export { CreateSession, SessionPoolOptions } from "./session_pool/session_pool";
export { StealthOptions } from "./stealth/stealth";
export { ActorRun } from "./typedefs";
export { MemoryInfo } from "./utils";
export { LoggerOptions } from "./utils_log";
export { RequestAsBrowserOptions, AbortFunction } from "./utils_request";
export { SocialHandles } from "./utils_social";