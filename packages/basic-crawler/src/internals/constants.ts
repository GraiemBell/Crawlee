/**
 * Additional number of seconds used in {@apilink CheerioCrawler} and {@apilink BrowserCrawler} to set a reasonable
 * {@apilink BasicCrawlerOptions.requestHandlerTimeoutSecs|`requestHandlerTimeoutSecs`} for {@apilink BasicCrawler}
 * that would not impare functionality (not timeout before crawlers).
 */
export const BASIC_CRAWLER_TIMEOUT_BUFFER_SECS = 10;
