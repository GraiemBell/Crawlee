import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import _ from 'underscore';
import 'babel-polyfill';
import sinon from 'sinon';
import { delayPromise } from 'apify-shared/utilities';
import * as Apify from '../build/index';
import { RequestQueue, RequestQueueLocal } from '../build/request_queue';
import { LOCAL_EMULATION_DIR } from './_helper';

chai.use(chaiAsPromised);

describe('BasicCrawler', () => {
    it('should run in parallel thru all the requests', async () => {
        const startedAt = Date.now();
        const sources = _.range(0, 500).map(index => ({ url: `https://example.com/${index}` }));

        const processed = [];
        const requestList = new Apify.RequestList({ sources });
        const handleRequestFunction = async ({ request }) => {
            await delayPromise(10);
            processed.push(_.pick(request, 'url'));
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            minConcurrency: 25,
            maxConcurrency: 25,
            handleRequestFunction,
        });

        await requestList.initialize();
        await basicCrawler.run();

        expect(processed).to.be.eql(sources);
        expect(Date.now() - startedAt).to.be.within(200, 400);
        expect(await requestList.isFinished()).to.be.eql(true);
        expect(await requestList.isEmpty()).to.be.eql(true);
    });

    it('should retry failed requests', async () => {
        const sources = [
            { url: 'http://example.com/1' },
            { url: 'http://example.com/2' },
            { url: 'http://example.com/3' },
        ];
        const processed = {};
        const requestList = new Apify.RequestList({ sources });

        const handleRequestFunction = async ({ request }) => {
            await delayPromise(10);
            processed[request.url] = request;

            if (request.url === 'http://example.com/2') {
                throw Error(`This is ${request.retryCount}th error!`);
            }

            request.userData.foo = 'bar';
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            maxRequestRetries: 10,
            minConcurrency: 3,
            maxConcurrency: 3,
            handleRequestFunction,
        });

        await requestList.initialize();
        await basicCrawler.run();

        expect(processed['http://example.com/1'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/1'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/1'].retryCount).to.be.eql(0);
        expect(processed['http://example.com/3'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/3'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/3'].retryCount).to.be.eql(0);

        expect(processed['http://example.com/2'].userData.foo).to.be.a('undefined');
        expect(processed['http://example.com/2'].errorMessages).to.have.lengthOf(11);
        expect(processed['http://example.com/2'].retryCount).to.be.eql(10);

        expect(await requestList.isFinished()).to.be.eql(true);
        expect(await requestList.isEmpty()).to.be.eql(true);
    });

    it('should not retry requests with ignoreErrors set to true ', async () => {
        const sources = [
            { url: 'http://example.com/1', ignoreErrors: true },
            { url: 'http://example.com/2' },
            { url: 'http://example.com/3', ignoreErrors: true },
        ];
        const processed = {};
        const requestList = new Apify.RequestList({ sources });

        const handleRequestFunction = async ({ request }) => {
            await delayPromise(10);
            processed[request.url] = request;
            request.userData.foo = 'bar';
            throw Error(`This is ${request.retryCount}th error!`);
        };

        let handleFailedRequestFunctionCalls = 0;
        const handleFailedRequestFunction = () => {
            handleFailedRequestFunctionCalls++;
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            maxRequestRetries: 10,
            minConcurrency: 3,
            maxConcurrency: 3,
            handleRequestFunction,
            handleFailedRequestFunction,
        });

        await requestList.initialize();
        await basicCrawler.run();

        expect(processed['http://example.com/1'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/1'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/1'].retryCount).to.be.eql(0);
        expect(processed['http://example.com/3'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/3'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/3'].retryCount).to.be.eql(0);

        expect(processed['http://example.com/2'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/2'].errorMessages).to.have.lengthOf(11);
        expect(processed['http://example.com/2'].retryCount).to.be.eql(10);

        expect(handleFailedRequestFunctionCalls).to.be.eql(1);

        expect(await requestList.isFinished()).to.be.eql(true);
        expect(await requestList.isEmpty()).to.be.eql(true);
    });

    it('should allow to handle failed requests', async () => {
        const sources = [
            { url: 'http://example.com/1' },
            { url: 'http://example.com/2' },
            { url: 'http://example.com/3' },
        ];
        const processed = {};
        const failed = {};
        const errors = [];
        const requestList = new Apify.RequestList({ sources });

        const handleRequestFunction = async ({ request }) => {
            await Promise.reject(new Error('some-error'));
            processed[request.url] = request;
        };

        const handleFailedRequestFunction = async ({ request, error }) => {
            failed[request.url] = request;
            errors.push(error);
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            handleRequestFunction,
            handleFailedRequestFunction,
        });

        await requestList.initialize();
        await basicCrawler.run();

        expect(failed['http://example.com/1'].errorMessages).to.have.lengthOf(4);
        expect(failed['http://example.com/1'].retryCount).to.be.eql(3);
        expect(failed['http://example.com/2'].errorMessages).to.have.lengthOf(4);
        expect(failed['http://example.com/2'].retryCount).to.be.eql(3);
        expect(failed['http://example.com/3'].errorMessages).to.have.lengthOf(4);
        expect(failed['http://example.com/3'].retryCount).to.be.eql(3);
        expect(_.values(failed)).to.have.length.of(3);
        expect(_.values(processed)).to.have.length.of(0);
        expect(await requestList.isFinished()).to.be.eql(true);
        expect(await requestList.isEmpty()).to.be.eql(true);
        errors.forEach(error => expect(error).to.be.an('error'));
    });

    it('should require at least one of RequestQueue and RequestList', () => {
        const requestList = new Apify.RequestList({ sources: [] });
        const requestQueue = new RequestQueue('xxx');
        const handleRequestFunction = () => {};

        expect(() => new Apify.BasicCrawler({ handleRequestFunction })).to.throw();
        expect(() => new Apify.BasicCrawler({ handleRequestFunction, requestList })).to.not.throw();
        expect(() => new Apify.BasicCrawler({ handleRequestFunction, requestQueue })).to.not.throw();
        expect(() => new Apify.BasicCrawler({ handleRequestFunction, requestQueue, requestList })).to.not.throw();
    });

    it('should also support RequestQueueLocal', () => {
        const requestQueue = new RequestQueue('xxx');
        const requestQueueLocal = new RequestQueueLocal('xxx', LOCAL_EMULATION_DIR);
        const handleRequestFunction = () => {};

        expect(() => new Apify.BasicCrawler({ handleRequestFunction, requestQueue })).to.not.throw();
        expect(() => new Apify.BasicCrawler({ handleRequestFunction, requestQueue: requestQueueLocal })).to.not.throw();
    });

    it('should correctly combine RequestList and RequestQueue', async () => {
        const sources = [
            { url: 'http://example.com/0' },
            { url: 'http://example.com/1' },
            { url: 'http://example.com/2' },
        ];
        const processed = {};
        const requestList = new Apify.RequestList({ sources });
        const requestQueue = new RequestQueue('xxx');

        const handleRequestFunction = async ({ request }) => {
            await delayPromise(10);
            processed[request.url] = request;

            if (request.url === 'http://example.com/1') {
                throw Error(`This is ${request.retryCount}th error!`);
            }

            request.userData.foo = 'bar';
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            requestQueue,
            maxRequestRetries: 3,
            minConcurrency: 1,
            maxConcurrency: 1,
            handleRequestFunction,
        });

        // It enqueues all requests from RequestList to RequestQueue.
        const mock = sinon.mock(requestQueue);
        mock.expects('addRequest')
            .once()
            .withArgs(new Apify.Request(sources[0]), { forefront: true })
            .returns(Promise.resolve({ requestId: 'id-0' }));
        mock.expects('addRequest')
            .once()
            .withArgs(new Apify.Request(sources[1]), { forefront: true })
            .returns(Promise.resolve({ requestId: 'id-1' }));
        mock.expects('addRequest')
            .once()
            .withArgs(new Apify.Request(sources[2]), { forefront: true })
            .returns(Promise.resolve({ requestId: 'id-2' }));

        const request0 = new Apify.Request(Object.assign({ id: 'id-0' }, sources[0]));
        const request1 = new Apify.Request(Object.assign({ id: 'id-1' }, sources[1]));
        const request2 = new Apify.Request(Object.assign({ id: 'id-2' }, sources[2]));

        // 1st try
        mock.expects('fetchNextRequest').once().returns(Promise.resolve(request0));
        mock.expects('fetchNextRequest').once().returns(Promise.resolve(request1));
        mock.expects('fetchNextRequest').once().returns(Promise.resolve(request2));
        mock.expects('markRequestHandled')
            .once()
            .withArgs(request0)
            .returns(Promise.resolve());
        mock.expects('reclaimRequest')
            .once()
            .withArgs(request1)
            .returns(Promise.resolve());
        mock.expects('markRequestHandled')
            .once()
            .withArgs(request2)
            .returns(Promise.resolve());

        // 2nd try
        mock.expects('fetchNextRequest')
            .once()
            .returns(Promise.resolve(request1));
        mock.expects('reclaimRequest')
            .once()
            .withArgs(request1)
            .returns(Promise.resolve());

        // 3rd try
        mock.expects('fetchNextRequest')
            .once()
            .returns(Promise.resolve(request1));
        mock.expects('reclaimRequest')
            .once()
            .withArgs(request1)
            .returns(Promise.resolve());

        // 4rd try
        mock.expects('fetchNextRequest')
            .once()
            .returns(Promise.resolve(request1));
        mock.expects('reclaimRequest')
            .once()
            .withArgs(request1)
            .returns(Promise.resolve());
        mock.expects('markRequestHandled')
            .once()
            .withArgs(request1)
            .returns(Promise.resolve());


        mock.expects('fetchNextRequest')
            .once()
            .returns(Promise.resolve(null));

        mock.expects('isEmpty')
            .exactly(4)
            .returns(Promise.resolve(false));
        mock.expects('isEmpty')
            .once()
            .returns(Promise.resolve(true));
        mock.expects('isFinished')
            .once()
            .returns(Promise.resolve(true));

        await requestList.initialize();
        await basicCrawler.run();

        expect(processed['http://example.com/0'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/0'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/0'].retryCount).to.be.eql(0);
        expect(processed['http://example.com/2'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/2'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/2'].retryCount).to.be.eql(0);

        expect(processed['http://example.com/1'].userData.foo).to.be.a('undefined');
        expect(processed['http://example.com/1'].errorMessages).to.have.lengthOf(4);
        expect(processed['http://example.com/1'].retryCount).to.be.eql(3);

        expect(await requestList.isFinished()).to.be.eql(true);
        expect(await requestList.isEmpty()).to.be.eql(true);
    });

    it('should say that task is not ready requestList is not set and requestQueue is empty', async () => {
        const requestQueue = new RequestQueue('xxx');
        requestQueue.isEmpty = () => Promise.resolve(true);

        const crawler = new Apify.BasicCrawler({
            requestQueue,
            handleRequestFunction: () => {},
        });

        expect(await crawler._isTaskReadyFunction()).to.be.eql(false); // eslint-disable-line no-underscore-dangle
    });

    it('should be possible to override isFinishedFunction of underlying AutoscaledPool', async () => {
        const requestQueue = new RequestQueue('xxx');
        const processed = [];
        const queue = [];
        let isFinished = false;

        const basicCrawler = new Apify.BasicCrawler({
            requestQueue,
            minConcurrency: 1,
            maxConcurrency: 1,
            handleRequestFunction: async ({ request }) => {
                await delayPromise(10);
                processed.push(request);
            },
            isFinishedFunction: () => {
                return Promise.resolve(isFinished);
            },
        });

        const request0 = new Apify.Request({ url: 'http://example.com/0' });
        const request1 = new Apify.Request({ url: 'http://example.com/1' });

        const mock = sinon.mock(requestQueue);
        mock.expects('markRequestHandled').once().withArgs(request0).returns(Promise.resolve());
        mock.expects('markRequestHandled').once().withArgs(request1).returns(Promise.resolve());
        mock.expects('isFinished').never();
        requestQueue.fetchNextRequest = () => Promise.resolve(queue.pop());
        requestQueue.isEmpty = () => Promise.resolve(!queue.length);

        setTimeout(() => queue.push(request0), 2000);
        setTimeout(() => queue.push(request1), 2500);
        setTimeout(() => { isFinished = true; }, 3500);

        await basicCrawler.run();

        expect(processed).to.be.eql([request0, request1]);
    });

    it('should support maxRequestsPerCrawl parameter', async () => {
        const sources = [
            { url: 'http://example.com/1' },
            { url: 'http://example.com/2' },
            { url: 'http://example.com/3' },
            { url: 'http://example.com/4' },
            { url: 'http://example.com/5' },
        ];
        const processed = {};
        const requestList = new Apify.RequestList({ sources });

        const handleRequestFunction = async ({ request }) => {
            await delayPromise(10);
            processed[request.url] = request;
            if (request.url === 'http://example.com/2') throw Error();
            request.userData.foo = 'bar';
        };

        let handleFailedRequestFunctionCalls = 0;
        const handleFailedRequestFunction = () => {
            handleFailedRequestFunctionCalls++;
        };

        const basicCrawler = new Apify.BasicCrawler({
            requestList,
            maxRequestRetries: 3,
            maxRequestsPerCrawl: 3,
            maxConcurrency: 1,
            handleRequestFunction,
            handleFailedRequestFunction,
        });

        await requestList.initialize();
        await basicCrawler.run();

        expect(processed['http://example.com/1'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/1'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/1'].retryCount).to.be.eql(0);
        expect(processed['http://example.com/3'].userData.foo).to.be.eql('bar');
        expect(processed['http://example.com/3'].errorMessages).to.be.a('null');
        expect(processed['http://example.com/3'].retryCount).to.be.eql(0);

        expect(processed['http://example.com/2'].userData.foo).to.be.eql(undefined);
        expect(processed['http://example.com/2'].errorMessages).to.have.lengthOf(4);
        expect(processed['http://example.com/2'].retryCount).to.be.eql(3);

        expect(handleFailedRequestFunctionCalls).to.be.eql(1);

        expect(await requestList.isFinished()).to.be.eql(false);
        expect(await requestList.isEmpty()).to.be.eql(false);
    });
});
