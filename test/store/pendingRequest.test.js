var
  should = require('should'),
  sandbox = require('sinon').sandbox.create(),
  rewire = require('rewire'),
  PendingRequest = rewire('../../lib/store/PendingRequest');

describe('Test: store/PendingRequest', function () {
  var
    spyClearTimeout,
    spySetTimeout,
    dummyPendingExist = {
      message: {
        data: {
          connection: {},
          request: {
            requestId: 'exists'
          }
        }
      },
      timeout: 'timeoutDummyPendingExist',
      promise: {}
    },
    dummyPendingDoesNotExist = {
      message: {
        data: {
          connection: {},
          request: {
            requestId: 'doesnotexist'
          }
        }
      },
      timeout: 'timeoutDummyPendingDoesNotExist',
      promise: {}
    },
    dummyInvalidPending = {
      message: {
        data: {
          connection: {},
          notARequest: {
            notARequestId: 'invalid'
          }
        }
      },
      timeout: 'timeoutDummyInvalidPending',
      promise: {}
    };

  beforeEach(() => {
    spyClearTimeout = sandbox.stub();
    spySetTimeout = sandbox.stub();

    PendingRequest.__set__('clearTimeout', spyClearTimeout);
    PendingRequest.__set__('setTimeout', spySetTimeout);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('constructor must initialize pending', () => {
    var pendingRequest = new PendingRequest();

    should(pendingRequest.pending).be.an.Object();
  });

  it('method add must add an item to the pending', () => {
    var
      pendingRequest = new PendingRequest(),
      spyWithReturnTimeout = sandbox.spy(function () {
        return dummyPendingExist.timeout;
      });

    PendingRequest.__set__('setTimeout', spyWithReturnTimeout);

    pendingRequest.add(dummyPendingExist);

    /** TODO: Test if the callback of setTimeout is called after the delay in this.serverTimeout **/

    should(spyWithReturnTimeout.calledOnce).be.true();
    should(pendingRequest.pending[dummyPendingExist.message.data.request.requestId]).be.deepEqual(dummyPendingExist);
  });

  it('method add must not add an item to the pending if invalid', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.add(dummyInvalidPending);

    should(spySetTimeout.calledOnce).be.false();
    should(Object.keys(pendingRequest.pending).length).be.eql(0);
  });

  it('method getByRequestId must return an item to the pending if it exists', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    should(pendingRequest.getByRequestId(dummyPendingExist.message.data.request.requestId)).be.deepEqual(dummyPendingExist);
  });

  it('method getByRequestId must return undefined if an item does not exist in pending', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    should(pendingRequest.getByRequestId(dummyPendingDoesNotExist.message.data.request.requestId)).be.undefined();
  });

  it('method existsByRequestId must return true if the item exists', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    should(pendingRequest.existsByRequestId(dummyPendingExist.message.data.request.requestId)).be.true();
  });

  it('method existsByRequestId must return false if the item does not exist', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    should(pendingRequest.existsByRequestId(dummyPendingDoesNotExist.message.data.request.requestId)).be.false();
  });

  it('method removeByRequestId must remove an item from pending if it exist', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.removeByRequestId(dummyPendingExist.message.data.request.requestId);

    should(spyClearTimeout.calledWith('timeoutDummyPendingExist')).be.true();
    should(Object.keys(pendingRequest.pending).length).be.eql(0);
  });

  it('method removeByRequestId must not remove an item from pending if it does not exist', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.removeByRequestId(dummyPendingDoesNotExist.message.data.request.requestId);

    should(spyClearTimeout.calledWith('timeoutDummyPendingDoesNotExist')).be.false();
    should(Object.keys(pendingRequest.pending).length).be.eql(1);
  });

  it('method remove must remove an item from pending if it exist', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.remove(dummyPendingExist);

    should(spyClearTimeout.calledWith('timeoutDummyPendingExist')).be.true();
    should(Object.keys(pendingRequest.pending).length).be.eql(0);
  });

  it('method remove must not remove an item from pending if it does not exist', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.remove(dummyPendingDoesNotExist);

    should(spyClearTimeout.calledWith('timeoutDummyPendingDoesNotExist')).be.false();
    should(Object.keys(pendingRequest.pending).length).be.eql(1);
  });

  it('method remove must not remove an item from pending if argument is invalid', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.remove(dummyInvalidPending);

    should(spyClearTimeout.calledWith('timeoutDummyInvalidPending')).be.false();
    should(Object.keys(pendingRequest.pending).length).be.eql(1);
  });

  it('method clear must empty the pending', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    pendingRequest.clear();

    should(spyClearTimeout.calledWith('timeoutDummyPendingExist')).be.true();
    should(Object.keys(pendingRequest.pending).length).be.eql(0);
  });

  it('method getAll must return the pending', () => {
    var pendingRequest = new PendingRequest();

    pendingRequest.pending = {
      [dummyPendingExist.message.data.request.requestId]: dummyPendingExist
    };

    should(pendingRequest.getAll()).be.deepEqual(pendingRequest.pending);
  });
});