'use strict';

const
  rewire = require('rewire'),
  mockrequire = require('mock-require'),
  should = require('should'),
  sinon = require('sinon');

describe('/service/httpProxy', () => {
  let
    HttpProxy,
    proxy,
    httpProxy;

  beforeEach(() => {
    proxy = {
      broker: {
        brokerCallback: sinon.spy()
      },
      clientConnectionStore: {
        add: sinon.spy(),
        remove: sinon.spy()
      },
      config: {
        host: 'host',
        port: 1234,
        maxRequestSize: '100kb',
        http: {
          enabled: true,
          maxFormFileSize: '100kb'
        }
      },
      logAccess: sinon.spy()
    };


    mockrequire('http', {
      createServer: sinon.stub().returns({
        listen: sinon.spy()
      })
    });

    mockrequire.reRequire('../../lib/service/HttpProxy');
    HttpProxy = rewire('../../lib/service/HttpProxy');

    httpProxy = new HttpProxy();
    httpProxy.init(proxy);
  });

  afterEach(() => {
    mockrequire.stopAll();
  });

  describe('#init', () => {
    const
      sandbox = sinon.sandbox.create(),
      request = {
        url: 'url',
        method: 'method',
        httpVersion: '1.1',
        socket: {
          remoteAddress: '1.1.1.1'
        }
      },
      multipart = [
        '-----------------------------165748628625109734809700179',
        'Content-Disposition: form-data; name="foo"',
        '',
        'bar',
        '-----------------------------165748628625109734809700179',
        'Content-Disposition: form-data; name="baz"; filename="test-multipart.txt"',
        'Content-Type: text/plain',
        '',
        'YOLO\n\n\n',
        '-----------------------------165748628625109734809700179--'
      ].join('\r\n'),
      response = {
        writeHead: sandbox.spy()
      };

    beforeEach(() => {
      request.headers = {
        'x-forwarded-for': '2.2.2.2',
        'x-foo': 'bar'
      };
      request.on = sandbox.spy();
      request.resume = sandbox.spy();
      request.removeAllListeners = sandbox.stub().returnsThis();
    });

    afterEach(() => {
      sandbox.restore();
    });

    it('should throw if an invalid maxRequestSize is given', () => {
      proxy.config.maxRequestSize = 'invalid';

      return should(() => httpProxy.init(proxy))
        .throw('Invalid HTTP "maxRequestSize" parameter');
    });

    it('should throw if an invalid maxFormFileSize is given', () => {
      proxy.config.http.maxFormFileSize = 'invalid';

      return should(() => httpProxy.init(proxy))
        .throw('Invalid HTTP "maxFormFileSize" parameter');
    });

    it('should throw if no port is given', () => {
      delete proxy.config.port;

      return should(() => httpProxy.init(proxy))
        .throw('No HTTP port configured.');
    });

    it('should init the http server', () => {
      should(httpProxy.server.listen)
        .be.calledOnce()
        .be.calledWith(proxy.config.port, proxy.config.host);
    });

    it('should respond with error if the request is too big', () => {
      HttpProxy.__with__({
        replyWithError: sandbox.spy()
      })(() => {
        const cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

        request.headers['content-length'] = 9999999999;

        cb(request, response);

        should(request.resume).be.calledOnce();
        console.log(HttpProxy.__get__('replyWithError').firstCall.args);
        should(HttpProxy.__get__('replyWithError'))
          .be.calledOnce()
          .be.calledWithMatch(proxy, /^[0-9a-w-]+$/, {url: request.url, method: request.method}, response, {message: 'Error: maximum HTTP request size exceeded'});
      });
    });

    it('should reply with error if the actual data sent exceeds the maxRequestSize', () => {
      HttpProxy.__with__({
        replyWithError: sandbox.spy()
      })(() => {
        const cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

        httpProxy.maxRequestSize = 2;
        cb(request, response);

        const dataCB = request.on.firstCall.args[1];

        dataCB('a slightly too big chunk');
        should(request.removeAllListeners).be.calledTwice();

        should(HttpProxy.__get__('replyWithError'))
          .be.calledWithMatch(proxy, /^[0-9a-z-]+$/, {url: request.url, method: request.method}, response, {message: 'Error: maximum HTTP request size exceeded'});
      });
    });

    it('should reply with error if the content type is unsupported', () => {
      HttpProxy.__with__({
        replyWithError: sandbox.spy()
      })(() => {
        const cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

        request.headers['content-type'] = 'foo/bar';

        cb(request, response);

        should(request.resume).be.calledOnce();
        should(HttpProxy.__get__('replyWithError'))
          .be.calledOnce()
          .be.calledWithMatch(proxy, /^[0-9a-w-]+$/, {url: request.url, method: request.method}, response, {message: 'Unsupported content type: foo/bar'});
      });
    });

    it('should handle valid JSON request', (done) => {
      const resetSendRequest = HttpProxy.__set__('sendRequest', (_proxy, connId, res, pload) => {
        resetSendRequest();
        should(pload.content).be.exactly('chunk1chunk2chunk3');
        done();
      });

      const cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

      cb(request, response);

      should(proxy.clientConnectionStore.add)
        .be.calledOnce()
        .be.calledWithMatch({
          protocol: 'HTTP/1.1',
          ips: ['2.2.2.2', '1.1.1.1'],
          headers: {
            'x-forwarded-for': '2.2.2.2',
            'x-foo': 'bar'
          }
        });

      const dataCB = request.on.firstCall.args[1];
      dataCB('chunk1');
      dataCB('chunk2');
      dataCB('chunk3');

      request.on.lastCall.args[1]();
    });

    it('should handle valid x-www-form-urlencoded request', (done) => {
      const resetSendRequest = HttpProxy.__set__('sendRequest', (_proxy, connId, res, pload) => {
        resetSendRequest();
        should(pload.content).be.empty('');
        should(pload.json.foo).be.exactly('bar');
        should(pload.json.baz).be.exactly('1234');
        done();
      });

      let cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

      request.headers['content-type'] = 'application/x-www-form-urlencoded';

      cb(request, response);

      let dataCB = request.on.firstCall.args[1];
      dataCB('foo=bar&baz=1234');

      let endCB = request.on.lastCall.args[1];
      endCB();
    });

    it('should reply with error if the binary file size sent exceeds the maxFormFileSize', () => {
      HttpProxy.__with__({
        replyWithError: sandbox.spy()
      })(() => {
        const cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

        httpProxy.maxFormFileSize = 2;
        request.headers['content-type'] = 'multipart/form-data; boundary=---------------------------165748628625109734809700179';
        cb(request, response);

        const dataCB = request.on.firstCall.args[1];

        dataCB(multipart);

        should(request.removeAllListeners).be.calledTwice();
        should(HttpProxy.__get__('replyWithError'))
          .be.calledWithMatch(proxy, /^[0-9a-z-]+$/, {url: request.url, method: request.method}, response, {message: 'Error: maximum HTTP file size exceeded'});
      });
    });

    it('should handle valid multipart/form-data request', (done) => {
      const
        resetSendRequest = HttpProxy.__set__('sendRequest', (_proxy, connId, res, pload) => {
          resetSendRequest();
          should(pload.content).be.empty('');
          should(pload.json.foo).be.exactly('bar');
          should(pload.json.baz.filename).be.exactly('test-multipart.txt');
          should(pload.json.baz.mimetype).be.exactly('text/plain');
          should(pload.json.baz.file).be.exactly('WU9MTwoKCg==');
          done();
        });

      let cb = HttpProxy.__get__('http').createServer.firstCall.args[0];

      request.headers['content-type'] = 'multipart/form-data; boundary=---------------------------165748628625109734809700179';

      cb(request, response);

      let dataCB = request.on.firstCall.args[1];
      dataCB(multipart);

      let endCB = request.on.lastCall.args[1];
      endCB();
    });
  });

  describe('#sendRequest', () => {
    let
      sendRequest,
      payload,
      res,
      response;

    beforeEach(() => {
      sendRequest = HttpProxy.__get__('sendRequest');

      payload = {
        requestId: 'requestId',
        url: 'url?pretty'
      };
      response = {
        end: sinon.spy(),
        setHeader: sinon.spy(),
        writeHead: sinon.spy()
      };

      res = HttpProxy.__set__({
        replyWithError: sinon.spy()
      });
    });

    afterEach(() => {
      res();
    });

    it('should reply with error if one is received from Kuzzle', () => {
      const error = new Error('error');

      sendRequest(proxy, 'connectionId', response, payload);

      should(proxy.broker.brokerCallback)
        .be.calledOnce()
        .be.calledWith('httpRequest', payload.requestId, 'connectionId', payload);

      const brokerCb = proxy.broker.brokerCallback.firstCall.args[4];

      brokerCb(error);

      should(HttpProxy.__get__('replyWithError'))
        .be.calledOnce()
        .be.calledWith(proxy, 'connectionId', payload, response, error);
    });

    it('should output the result', () => {
      const result = {
        headers: {
          'x-foo': 'bar'
        },
        status: 'status',
        content: 'content'
      };

      sendRequest(proxy, 'connectionId', response, payload);
      const cb = proxy.broker.brokerCallback.firstCall.args[4];

      cb(undefined, result);

      should(response.setHeader)
        .be.calledOnce()
        .be.calledWith('x-foo', 'bar');

      should(response.writeHead)
        .be.calledOnce()
        .be.calledWith('status');

      should(response.end)
        .be.calledOnce()
        .be.calledWith(JSON.stringify(result.content, undefined, 2));
    });

    it('should output buffer raw result', () => {
      const result = {
        raw: true,
        status: 'status',
        content: new Buffer('test')
      };

      sendRequest(proxy, 'connectionId', response, payload);
      const cb = proxy.broker.brokerCallback.firstCall.args[4];

      cb(undefined, result);

      should(response.end)
        .be.calledOnce()
        .be.calledWith(result.content);
    });

    it('should output a stringified buffer as a raw buffer result', () => {
      const result = {
        raw: true,
        status: 'status',
        content: JSON.parse(JSON.stringify(new Buffer('test')))
      };

      sendRequest(proxy, 'connectionId', response, payload);
      const cb = proxy.broker.brokerCallback.firstCall.args[4];

      cb(undefined, result);

      should(response.end)
        .be.calledOnce()
        .be.calledWithMatch(Buffer.from(result.content));
    });

    it('should output serialized JS objects marked as raw', () => {
      const result = {
        raw: true,
        status: 'status',
        content: [{foo: 'bar'}]
      };

      sendRequest(proxy, 'connectionId', response, payload);
      const cb = proxy.broker.brokerCallback.firstCall.args[4];

      cb(undefined, result);

      should(response.end)
        .be.calledWith(JSON.stringify(result.content));
    });

    it('should output scalar content as-is if marked as raw', () => {
      const result = {
        raw: true,
        status: 'status',
        content: 'content'
      };

      sendRequest(proxy, 'connectionId', response, payload);
      const cb = proxy.broker.brokerCallback.firstCall.args[4];

      cb(undefined, result);

      should(response.end)
        .be.calledOnce()
        .be.calledWithExactly(result.content);
    });
  });

  describe('#replyWithError', () => {
    let
      replyWithError,
      response;

    beforeEach(() => {
      replyWithError = HttpProxy.__get__('replyWithError');
      response = {
        end: sinon.spy(),
        writeHead: sinon.spy()
      };
    });

    it('should log the access and reply with error', () => {
      const error = new Error('test');
      error.status = 'status';

      replyWithError(proxy, 'connectionId', 'payload', response, error);

      should(proxy.logAccess)
        .be.calledOnce()
        .be.calledWithMatch('connectionId', 'payload', error, {
          raw: true,
          content: JSON.stringify(error)
        });

      should(response.writeHead)
        .be.calledOnce()
        .be.calledWith('status', {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods' : 'GET,POST,PUT,DELETE,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With'
        });
    });

    it('should remove pending request from clientConnectionStore', () => {
      const error = new Error('test');
      error.status = 'status';

      replyWithError(proxy, 'connectionId', 'payload', response, error);

      should(proxy.clientConnectionStore.remove)
        .be.calledOnce()
        .be.calledWithMatch('connectionId');
    });
  });

});

