'use strict';

const
  _ = require('lodash'),
  rewire = require('rewire'),
  should = require('should'),
  sinon = require('sinon'),
  Promise = require('bluebird'),
  KuzzleProxy = rewire('../../lib/core/KuzzleProxy'),
  proxyConfig = require('../../lib/core/config');

describe('lib/core/KuzzleProxy', () => {
  let
    BackendHandler = sinon.spy(),
    reset,
    proxy,
    winstonTransportConsole,
    winstonTransportFile,
    winstonTransportElasticsearch,
    winstonTransportSyslog;

  beforeEach(() => {
    winstonTransportConsole = sinon.spy();
    winstonTransportElasticsearch = sinon.spy();
    winstonTransportFile = sinon.spy();
    winstonTransportSyslog = sinon.spy();

    reset = KuzzleProxy.__set__({
      config: _.cloneDeep(proxyConfig),
      Broker: sinon.spy(function () {
        this.init = sinon.spy();                // eslint-disable-line no-invalid-this
      }),
      Context: sinon.spy(),
      HttpProxy: sinon.spy(function () {
        this.init = sinon.spy();                // eslint-disable-line no-invalid-this
      }),
      WsProxy: sinon.spy(function () {
        this.init = sinon.spy();                // eslint-disable-line no-invalid-this
      }),
      winston: {
        Logger: sinon.spy(),
        transports: {
          Console: winstonTransportConsole,
          File: winstonTransportFile
        }
      },
      WinstonElasticsearch: winstonTransportElasticsearch,
      WinstonSyslog: winstonTransportSyslog
    });

    proxy = new KuzzleProxy(BackendHandler);

    Object.defineProperty(proxy, 'log', {
      enumerable: true,
      value: {
        info: sinon.spy(),
        warn: sinon.spy(),
        error: sinon.spy()
      }
    });
  });

  afterEach(() => {
    reset();
  });

  describe('#log getter', () => {
    it('should return the error logger', () => {
      proxy = new KuzzleProxy(BackendHandler);
      proxy.loggers = {
        errors: {foo: 'bar'}
      };

      should(proxy.log)
        .be.exactly(proxy.loggers.errors);
    });
  });

  describe('#start', () => {
    it('should call proper methods in order', () => {
      proxy.initLogger = sinon.spy();
      proxy.installPluginsIfNeeded = sinon.stub().returns(Promise.resolve());
      proxy.loadPlugins = sinon.spy();

      proxy.start();
      should(proxy.initLogger)
        .be.calledOnce();
      should(proxy.loadPlugins)
        .be.calledOnce();
      should(proxy.broker.init)
        .be.calledOnce();
      should(proxy.httpProxy.init)
        .be.calledOnce();
      sinon.assert.callOrder(
        proxy.initLogger,
        proxy.broker.init,
        proxy.httpProxy.init,
        proxy.wsProxy.init,
        proxy.loadPlugins
      );
    });

    it('should log and rethrow if an error occured', () => {
      const error = new Error('test');

      proxy.loadPlugins = sinon.stub().throws(error);
      proxy.initLogger = () => {
        proxy.loggers.error = {
          error: sinon.spy()
        };
      };

      try {
        proxy.start();
      } catch (e) {
        should(proxy.log.error)
          .be.calledOnce()
          .be.calledWith(e);
      }
    });
  });

  describe('#loadPlugins', () => {
    it('should load plugins as NodeJS modules and simple require-ables', () => {
      let existsStub = sinon.stub();
      existsStub.onFirstCall().returns(1);
      existsStub.onSecondCall().returns(0);

      return KuzzleProxy.__with__({
        fs: {
          readdirSync: () => {
            return ['kuzzle-plugin-test', 'kuzzle-plugin-invalid'];
          },
          existsSync: existsStub,
          statSync: () => {
            return {
              isSymbolicLink: () => {
                return false;
              },
              isDirectory: () => {
                return true;
              }
            };
          }
        }
      })(() => {
        sinon.stub(proxy, 'loadPlugin')
          .onFirstCall().returns({
            name: 'myPlugin'
          })
          .onSecondCall().throws(new Error('Something bad happened'));
        sinon.stub(proxy, 'initPlugin');

        proxy.loadPlugins();

        should(proxy.loadPlugin)
          .be.calledTwice();
        should(proxy.log.error)
          .be.calledOnce();
        should(proxy.initPlugin)
          .be.calledOnce();
      });
    });
  });

  describe('#loadPlugin', () => {
    it('should return a valid plugin definition if the path is correct', () => {
      let pluginClassSpy = sinon.spy();
      let requireStub = sinon.stub();
      let name = 'foo';
      requireStub.onFirstCall().returns(pluginClassSpy);
      requireStub.onSecondCall().returns({
        name: name
      });
      return KuzzleProxy.__with__({
        path: {
          resolve: () => {},
          basename: () => {
            return 'plugin-foo';
          }
        },
        require: requireStub,
        fs: {
          existsSync: () => {
            return true;
          }
        }
      })(() => {
        let definition = proxy.loadPlugin();

        should(definition)
          .be.Object();
        should(definition)
          .have.keys('name', 'object', 'config', 'path');
        should(definition.name)
          .be.eql(name);
        should(pluginClassSpy)
          .be.calledOnce();
      });
    });
  });

  describe('#initPlugin', () => {
    it('should initialize the plugin', () => {
      sinon.stub(proxy.protocolStore, 'add');
      let definition = {
        object: {
          init: sinon.spy()
        }
      };
      proxy.initPlugin(definition);

      should(proxy.log.info)
        .be.calledOnce();
      should(definition.object.init)
        .be.calledOnce();
      should(proxy.protocolStore.add)
        .be.calledOnce();
    });

    it('should log an error if plugin initialization fails', () => {
      let definition = {
        object: {
          init: sinon.stub()
            .throws(new Error('this is not an error'))
        }
      };
      proxy.initPlugin(definition);

      should(proxy.log.info)
        .be.calledOnce();
      should(definition.object.init)
        .be.calledOnce();
      should(proxy.log.error)
        .be.calledOnce();
    });
  });

  describe('#initLogger', () => {
    it('should support all available transports', () => {
      proxy.config.logs.access = [{
        level: 'level',
        silent: 'silent',
        colorize: 'colorize',
        timestamp: 'timestamp',
        json: 'json',
        stringify: 'stringify',
        prettyPrint: 'prettyPrint',
        depth: 'depth',
        showLevel: 'showLevel'
      }];
      proxy.config.logs.access.push(Object.assign({}, proxy.config.logs.access));
      proxy.config.logs.errors = [Object.assign({}, proxy.config.logs.access)];
      proxy.config.logs.errors.push(Object.assign({}, proxy.config.logs.access));

      proxy.config.logs.access[0].transport = 'console';
      proxy.config.logs.access[0].humanReadableUnhandledException = 'humanReadableUnhandledException';

      proxy.config.logs.access[1].transport = 'file';
      Object.assign(proxy.config.logs.access[1], {
        filename: 'filename',
        maxSize: 'maxSize',
        maxFiles: 'maxFiles',
        eol: 'eol',
        logstash: 'logstash',
        tailable: 'tailable',
        maxRetries: 'maxRetries',
        zippedArchive: 'zippedArchive'
      });

      proxy.config.logs.errors[0].transport = 'elasticsearch';
      Object.assign(proxy.config.logs.errors[0], {
        index: 'index',
        indexPrefix: 'indexPrefix',
        indexSuffixPattern: 'indexSuffixPattern',
        messageType: 'messageType',
        ensureMappingTemplate: 'ensureMappingTemplate',
        mappingTemplate: 'mappingTemplate',
        flushInterval: 'flushInterval',
        clientOpts: 'clientOpts'
      });

      proxy.config.logs.errors[1].transport = 'syslog';
      Object.assign(proxy.config.logs.errors[1], {
        host: 'host',
        port: 'port',
        protocol: 'protocol',
        path: 'path',
        pid: 'pid',
        facility: 'facility',
        localhost: 'localhost',
        type: 'type',
        app_name: 'app_name',
        eol: 'eol'
      });

      proxy.initLogger();

      should(winstonTransportConsole)
        .be.calledOnce()
        .be.calledWithMatch({
          level: 'level',
          silent: 'silent',
          colorize: 'colorize',
          timestamp: 'timestamp',
          json: 'json',
          stringify: 'stringify',
          prettyPrint: 'prettyPrint',
          depth: 'depth',
          showLevel: 'showLevel',
          humanReadableUnhandledException: 'humanReadableUnhandledException'
        });

    });
  });

  describe('#logAccess', () => {
    beforeEach(() => {
      proxy.loggers = {
        access: {
          info: sinon.spy()
        }
      };
    });

    it('should trigger an warn log if no connection could be found', () => {
      proxy.logAccess(-1);

      should(proxy.log.warn)
        .be.calledOnce()
        .be.calledWith('[access log] No connection retrieved for connection id: -1\n' +
          'Most likely, the connection was closed before the response we received.');

      should(proxy.loggers.access.info)
        .have.callCount(0);
    });

    it('should forward the params to the logger when using "logstash" format output', () => {
      const
        connection = {foo: 'bar' },
        request = {foo: 'bar' },
        error = new Error('test'),
        result = {foo: 'bar', status: 'resultStatus'};
      error.status = '444';

      proxy.clientConnectionStore.get = sinon.stub().returns(connection);
      proxy.config.logs.accessLogFormat = 'logstash';

      proxy.logAccess(connection, request, error, result);
      should(proxy.loggers.access.info)
        .be.calledOnce()
        .be.calledWithMatch({
          connection,
          request,
          error: 'Error: test',
          status: '444'
        });
    });

    it('should output combined logs from an http request', () => {
      const
        connection = {
          protocol: 'HTTP/1.1',
          headers: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiJhZG1pbiIsImlhdCI6MTQ4MjE3MDQwNywiZXhwIjoxNDgyMTg0ODA3fQ.SmLTFuIPsVuA8Pgpf9XONW2RtxcHjQffthNZ5Er4L4s',
            referer: 'http://referer.com',
            'user-agent': 'user agent'
          },
          ips: ['1.1.1.1', '2.2.2.2']
        },
        request = {
          url: 'url',
          method: 'METHOD',
          data: {
            index: 'index',
            collection: 'collection'
          }
        },
        result = {
          status: 'status'
        };

      proxy.clientConnectionStore.get = sinon.stub().returns(connection);
      proxy.config.logs.accessLogFormat = 'combined';
      proxy.config.logs.accessLogIpOffset = 1;

      proxy.logAccess(connection, request, null, result);

      should(proxy.loggers.access.info)
        .be.calledOnce()
        .be.calledWithMatch(/^1\.1\.1\.1 - admin \[\d\d\/[A-Z][a-z]{2}\/\d{4}:\d\d:\d\d:\d\d [+-]\d{4}] "METHOD url HTTP\/1\.1" status 9 "http:\/\/referer.com" "user agent"$/);
    });

    it('should use the error status in priority', () => {
      const
        connection = {
          protocol: 'websocket',
          headers: {
            referer: 'http://referer.com',
            'user-agent': 'user agent'
          },
          ips: ['1.1.1.1', '2.2.2.2']
        },
        request = {
          data: {
            timestamp: 'timestamp',
            requestId: 'requestId',
            jwt: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJfaWQiOiJhZG1pbiIsImlhdCI6MTQ4MjE3MDQwNywiZXhwIjoxNDgyMTg0ODA3fQ.SmLTFuIPsVuA8Pgpf9XONW2RtxcHjQffthNZ5Er4L4s',
            controller: 'controller',
            action: 'action',
            index: 'index',
            collection: 'collection',
            _id: 'id',
            foo: 'bar'
          }
        },
        error = new Error('test'),
        result = {
          status: 'status'
        };

      proxy.config.logs.accessLogFormat = 'combined';
      proxy.clientConnectionStore.get = sinon.stub().returns(connection);

      proxy.logAccess(1, request, error, result);
      should(proxy.loggers.access.info)
        .be.calledOnce()
        .be.calledWithMatch(/^2\.2\.2\.2 - admin \[\d\d\/[A-Z][a-z]{2}\/\d{4}:\d\d:\d\d:\d\d [+-]\d{4}] "DO \/controller\/action\/index\/collection\/id\?foo=bar WEBSOCKET" 500 9 "http:\/\/referer\.com" "user agent"/);

      error.status = 'ERR';
      proxy.logAccess(1, request, error, result);
      should(proxy.loggers.access.info)
        .be.calledTwice();
      should(proxy.loggers.access.info.secondCall.args[0])
        .match(/^2\.2\.2\.2 - admin \[\d\d\/[A-Z][a-z]{2}\/\d{4}:\d\d:\d\d:\d\d [+-]\d{4}] "DO \/controller\/action\/index\/collection\/id\?foo=bar WEBSOCKET" ERR 9 "http:\/\/referer\.com" "user agent"/);
    });

    it('should extract the user from Basic auth header', () => {
      const
        connection = {
          protocol: 'HTTP/1.0',
          headers: {
            authorization: 'Zm9vOmJhcg=='   // base64('foo:bar')
          },
          ips: ['1.1.1.1']
        },
        request = {
          url: 'url',
          method: 'GET'
        },
        result = {
          raw: true,
          content: 'test'
        };

      proxy.config.logs.accessLogFormat = 'combined';
      proxy.clientConnectionStore.get = sinon.stub().returns(connection);

      proxy.logAccess(1, request, undefined, result);

      should(proxy.loggers.access.info)
        .be.calledWithMatch(/^1\.1\.1\.1 - foo \[/);
    });

    it('should log a warning if the user could not be extracted from http headers', () => {
      const
        connection = {
          protocol: 'HTTP/1.0',
          headers: {
            authorization: 'Bearer invalid'
          },
          ips: ['ip']
        },
        request = {
          url: 'url',
          method: 'GET'
        },
        result = {
          raw: true,
          status: 300,
          content: 'test'
        };

      proxy.config.logs.accessLogFormat = 'combined';
      proxy.clientConnectionStore.get = sinon.stub().returns(connection);
      proxy.loggers.errors = {
        warn: sinon.spy()
      };

      proxy.logAccess(1, request, undefined, result);

      should(proxy.log.warn)
        .be.calledOnce()
        .be.calledWith('Unable to extract user from authorization header: Bearer invalid');
      should(proxy.loggers.access.info)
        .be.calledOnce()
        .be.calledWithMatch(/^ip - - \[\d\d\/[A-Z][a-z]{2}\/\d{4}:\d\d:\d\d:\d\d [+-]\d{4}] "GET url HTTP\/1.0" 300 4 - -$/);
    });

    it('should log a warning if the user could not be extracted from jwt token', () => {
      const
        connection = {
          protocol: 'websocket',
          headers: {},
          ips: ['ip']
        },
        request = {
          data: {
            timestamp: 'timestamp',
            requestId: 'requestId',
            jwt: 'invalid',
            controller: 'controller',
            action: 'action',
            index: 'index',
            collection: 'collection',
            _id: 'id',
            foo: 'bar'
          }
        },
        result = {
          raw: true,
          content: 'test'
        };

      proxy.config.logs.accessLogFormat = 'combined';
      proxy.clientConnectionStore.get = sinon.stub().returns(connection);
      proxy.loggers.errors = {
        warn: sinon.spy()
      };

      proxy.logAccess(1, request, undefined, result);

      should(proxy.log.warn)
        .be.calledOnce()
        .be.calledWith('Unable to extract user from jwt token: invalid');
    });
  });


});
