'use strict';

const
  should = require('should'),
  rewire = require('rewire'),
  Backend = rewire('../../lib/service/Backend'),
  sinon = require('sinon'),
  PendingRequest = require.main.require('lib/store/PendingRequest');

describe('service/Backend', () => {
  let
    backend,
    proxy,
    socket;

  beforeEach(() => {
    proxy = {
      backendHandler: {
        activateBackend: sinon.stub(),
        removeBackend: sinon.spy(),
        getBackend: sinon.stub()
      },
      clientConnectionStore: {
        get: sinon.stub(),
        getAll: sinon.stub()
      },
      config: {
        backend: {
          timeout: 'timeout'
        }
      },
      log: {
        error: sinon.spy(),
        warn: sinon.spy()
      },
      protocolStore: {
        get: sinon.stub().returns({
          joinChannel: sinon.spy(),
          leaveChannel: sinon.spy(),
          notify: sinon.spy(),
          disconnect: sinon.spy()
        })
      }
    };

    socket = {
      close: sinon.spy(),
      on: sinon.spy(),
      send: sinon.spy()
    };

    backend = new Backend(socket, {connection: {remoteAddress: 'ip'}}, proxy);
  });

  afterEach(() => {
  });


  describe('#constructor', () => {
    it('should init the request queue and attach events', () => {
      should(backend.backendRequestStore)
        .be.an.instanceOf(PendingRequest);

      should(socket.on)
        .be.calledThrice()
        .be.calledWith('close')
        .be.calledWith('error')
        .be.calledWith('message');

      backend.onConnectionClose = sinon.spy();
      backend.onConnectionError = sinon.spy();
      backend.onMessage = sinon.spy();

      {
        const closeHandler = socket.on.firstCall.args[1];

        closeHandler();
        should(backend.onConnectionClose)
          .be.calledOnce();
      }

      {
        const
          errorHandler = socket.on.secondCall.args[1],
          error = new Error('test');

        errorHandler(error);
        should(backend.onConnectionError)
          .be.calledOnce()
          .be.calledWith(error);
      }

      {
        const
          messageHandler = socket.on.thirdCall.args[1],
          message = {foo: 'bar'};

        messageHandler(message);
        should(backend.onMessage)
          .be.calledOnce()
          .be.calledWith(message);
      }

    });
  });

  describe('#onMessage', () => {
    it('should log an error if the message cannot be parsed', () => {
      backend.onMessage('invalid json');

      should(proxy.log.error)
        .be.calledOnce()
        .be.calledWithMatch(/^Bad message received from the backend: invalid json/);
    });

    it('should log an error if no room is given', () => {
      backend.onMessage('{}');

      should(proxy.log.error)
        .be.calledOnce()
        .be.calledWith('Room is not specified in message: {}');
    });

    it('should log an error if the room is unknonwn', () => {
      backend.onMessage(JSON.stringify({
        room: 'idontexist'
      }));

      should(proxy.log.error)
        .be.calledOnce()
        .be.calledWith('Unknown message type idontexist');
    });

    it('should call the proper action', () => {
      backend.onMessageRooms.foo = sinon.spy();

      backend.onMessage(JSON.stringify({
        room: 'foo',
        data: 'bar'
      }));

      should(backend.onMessageRooms.foo)
        .be.calledOnce()
        .be.calledWith('bar');
    });
  });

  describe('#onConnectionClose', () => {
    it('should remove the backend and abort all pending requests', () => {
      backend.active = true;
      backend.backendRequestStore.abortAll = sinon.spy();
      proxy.backendHandler.getBackend.returns({socketIp: 'a_backend', active: true});

      backend.onConnectionClose();

      should(proxy.backendHandler.removeBackend)
        .be.calledOnce()
        .be.calledWith(backend);

      should(backend.backendRequestStore.abortAll)
        .be.calledOnce();

      should(socket.close)
        .be.calledOnce();
    });

    it('should remove all client connection if no backend left', () => {
      proxy.backendHandler.getBackend.returns(null);
      proxy.clientConnectionStore.getAll.returns([
        {protocol: 'test', id: 42}
      ]);

      backend.onConnectionClose();

      should(proxy.protocolStore.get.firstCall)
        .be.calledOnce()
        .be.calledWith('test');

      should(proxy.protocolStore.get.firstCall.returnValue.disconnect)
        .be.calledOnce()
        .be.calledWith(42);
    });
  });

  describe('#onConnectionError', () => {
    it('should remove the backend and abort all pending requests', () => {
      const error = new Error('test');

      backend.active = true;
      backend.backendRequestStore.abortAll = sinon.spy();

      backend.onConnectionError(error);

      should(proxy.backendHandler.removeBackend)
        .be.calledOnce()
        .be.calledWith(backend);

      should(backend.backendRequestStore.abortAll)
        .be.calledOnce();
    });
  });

  describe('#send', () => {
    it('should register the cb and call the backend', () => {
      backend.active = true;
      backend.backendRequestStore.add = sinon.spy();

      backend.send('room', 'id', 'data', 'callback');

      should(backend.backendRequestStore.add)
        .be.calledOnce()
        .be.calledWith('id', 'data', 'callback');

      should(socket.send)
        .be.calledOnce()
        .be.calledWith(JSON.stringify({room: 'room', data: 'data'}));
    });
  });

  describe('#sendRaw', () => {
    it('should forward the request to the backend socket', () => {
      backend.active = true;
      backend.sendRaw('room', 'data', 'callback');

      should(socket.send)
        .be.calledOnce()
        .be.calledWith(JSON.stringify({room: 'room', data: 'data'}), 'callback');
    });
  });

  describe('#room actions', () => {
    beforeEach(() => {
      backend.backendRequestStore.resolve = sinon.spy();
      proxy.clientConnectionStore.get.returns({
        protocol: 'dummy'
      });
    });

    describe('#response', () => {

      it('should resolve with response`s data', () => {
        const data = {
          requestId: 'requestId'
        };

        backend.onMessageRooms.response(data);
        should(backend.backendRequestStore.resolve)
          .be.calledOnce()
          .be.calledWith('requestId', null, data);
      });
    });

    describe('#httpResponse', () => {

      it('should resolve with response`s data', () => {
        const data = {
          requestId: 'requestId'
        };

        backend.onMessageRooms.httpResponse(data);

        should(backend.backendRequestStore.resolve)
          .be.calledOnce()
          .be.calledWith('requestId', null, data);
      });
    });

    describe('#joinChannel', () => {
      it('should handle errors', () => {
        const
          data = {
            connectionId: 'id'
          },
          error = new Error('test');

        proxy.protocolStore.get.returns({
          joinChannel: sinon.stub().throws(error)
        });

        backend.onMessageRooms.joinChannel(data);

        should(proxy.log.error)
          .be.calledOnce()
          .be.calledWith('[Join Channel] Protocol dummy failed: test');
      });

      it('should join the protocol`s channel', () => {
        const data = {
          connectionId: 'id'
        };

        backend.onMessageRooms.joinChannel(data);

        should(proxy.protocolStore.get)
          .be.calledOnce()
          .be.calledWith('dummy');

        should(proxy.protocolStore.get.firstCall.returnValue.joinChannel)
          .be.calledOnce()
          .be.calledWith(data);

      });
    });

    describe('#leaveChannel', () => {
      it('should log errors', () => {
        const
          data = {
            connectionId: 'id'
          },
          error = new Error('test');

        proxy.protocolStore.get.throws(error);

        backend.onMessageRooms.leaveChannel(data);

        should(proxy.log.error)
          .be.calledOnce()
          .be.calledWith('[Leave Channel] Protocol undefined failed: test');
      });

      it('should leave from protocol`s channel', () => {
        const data = {
          connectionId: 'id'
        };

        backend.onMessageRooms.leaveChannel(data);

        should(proxy.protocolStore.get.firstCall.returnValue.leaveChannel)
          .be.calledOnce()
          .be.calledWith(data);
      });
    });

    describe('#notify', () => {
      it('should log errors', () => {
        const
          data = {
            connectionId: 'id'
          },
          error = new Error('test');

        proxy.protocolStore.get.throws(error);

        backend.onMessageRooms.notify(data);

        should(proxy.log.error)
          .be.calledOnce()
          .be.calledWith('[Notify] Protocol dummy failed: test\nNotification data:\n%s');
      });

      it('should use protocoleStore to notify client', () => {
        const data = {
          connectionId: 'id'
        };

        backend.onMessageRooms.notify(data);

        should(proxy.protocolStore.get.firstCall.returnValue.notify)
          .be.calledOnce()
          .be.calledWith(data);
      });
    });

    describe('#broadcast', () => {
      it('should handle errors', () => {
        const
          data = {
            connectionId: 'id'
          },
          error = new Error('test');

        proxy.protocolStore.protocols = {
          foo: {
            broadcast: sinon.spy()
          },
          bar: {
            broadcast: sinon.stub().throws(error)
          }
        };

        backend.onMessageRooms.broadcast(data);

        should(proxy.log.error)
          .be.calledOnce()
          .be.calledWith('[Broadcast] Protocol bar failed: test\nNotification data:\n%s');
      });

      it('should broadcast notification to all protocols', () => {
        const data = {
          connectionId: 'id'
        };

        proxy.protocolStore.protocols = {
          foo: {
            broadcast: sinon.spy()
          },
          bar: {
            broadcast: sinon.spy()
          }
        };

        backend.onMessageRooms.broadcast(data);

        should(proxy.protocolStore.protocols.foo.broadcast)
          .be.calledOnce()
          .be.calledWith(data);
        should(proxy.protocolStore.protocols.bar.broadcast)
          .be.calledOnce()
          .be.calledWith(data);
      });
    });

    describe('#ready', () => {
      beforeEach(() => {
        backend.active = false;
        backend.proxy.clientConnectionStore.getAll.returns([
          {connectionId: 'connection1', protocol: 'protocol'},
          {connectionId: 'connection2', protocol: 'protocol'},
          {connectionId: 'connection3', protocol: 'protocol'}
        ]);
        backend.onConnectionClose = sinon.spy();
        backend.sendRaw = sinon.spy();
      });

      it('should send client connections and buffered requests', (done) => {
        Backend.__with__({
          'async.each': (coll, iteratee, callback) => {
            callback.call(backend);

            should(backend.active).be.true();
            should(proxy.backendHandler.activateBackend).be.calledOnce();

            for (const clientConnection of coll) {
              // eslint-disable-next-line no-loop-func
              iteratee(clientConnection, () => {
                should(backend.sendRaw)
                  .be.calledWith('connection', {
                    connectionId: clientConnection.connectionId,
                    protocol: clientConnection.protocol
                  });
              });
            }

            done();
          }
        })(() => {
          backend.onMessageRooms.ready();
        });
      });

      it('should log an error and disconnect the backend if another backend is already active', (done) => {
        const error = new Error('foobar');

        proxy.backendHandler.activateBackend.throws(error);
        Backend.__with__({
          'async.each': (coll, iteratee, callback) => {
            callback.call(backend);

            should(backend.active).be.false();
            should(proxy.backendHandler.activateBackend).be.calledOnce();

            should(proxy.log.error)
              .be.calledOnce()
              .be.calledWith('%s:\n%s', 'foobar', error.stack);

            should(backend.onConnectionClose).be.calledOnce();

            done();
          }
        })(() => {
          backend.onMessageRooms.ready();
        });
      });
    });

    it('#shutdown', () => {
      backend.active = true;
      backend.onMessageRooms.shutdown();

      should(proxy.backendHandler.removeBackend)
        .be.calledOnce()
        .be.calledWith(backend);
    });

    it('#shutdown should do nothing if invoked more than once', () => {
      backend.active = false;

      backend.onMessageRooms.shutdown();

      should(proxy.backendHandler.removeBackend.called).be.false();
    });
  });

});
