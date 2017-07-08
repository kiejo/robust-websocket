(function(factory, global) {
  if (typeof define === 'function' && define.amd) {
    define(function() {
      return factory(global, navigator)
    })
  } else if (typeof exports === 'object' && typeof module === 'object') {
    module.exports = factory(global, navigator)
  } else {
    // mock the navigator object when under test since `navigator.onLine` is read only
    global.RobustWebSocket = factory(global, typeof Mocha !== 'undefined' ? Mocha : navigator)
  }
})(function(global, navigator) {

  var RobustWebSocket = function(url, protocols, userOptions) {
    var realWs = { close: function() {} },
        connectTimeout,
        self = this,
        attempts = 0,
        reconnects = -1,
        explicitlyClosed = false,
        pendingReconnect,
        opts = Object.assign({},
          RobustWebSocket.defaultOptions,
          typeof userOptions === 'function' ? { shouldReconnect: userOptions } : userOptions
        )

    if (typeof opts.timeout !== 'number') {
      throw new Error('timeout must be the number of milliseconds to timeout a connection attempt')
    }

    if (typeof opts.shouldReconnect !== 'function') {
      throw new Error('shouldReconnect must be a function that returns the number of milliseconds to wait for a reconnect attempt, or null or undefined to not reconnect.')
    }

    ['bufferedAmount', 'url', 'readyState', 'protocol', 'extensions'].forEach(function(readOnlyProp) {
      Object.defineProperty(self, readOnlyProp, {
        get: function() { return realWs[readOnlyProp] }
      })
    })

    function clearPendingReconnectIfNeeded() {
      if (pendingReconnect) {
        clearTimeout(pendingReconnect)
        pendingReconnect = null
      }
    }

    self.send = function() {
      return realWs.send.apply(realWs, arguments)
    }

    self.close = function(code, reason) {
      if (typeof code !== 'number') {
        reason = code
        code = 1000
      }

      clearPendingReconnectIfNeeded()
      explicitlyClosed = true

      return realWs.close(code, reason)
    }

    self.open = function() {
      if (realWs.readyState !== WebSocket.OPEN && realWs.readyState !== WebSocket.CONNECTING) {
        clearPendingReconnectIfNeeded()
        explicitlyClosed = false

        newWebSocket()
      }
    }

    self.refresh = function(fastClose) {
      clearPendingReconnectIfNeeded()
      clearTimeout(connectTimeout)

      var code = 1000
      var reason = 'refresh'
      realWs.close(code, reason)

      if (fastClose) {
        // Do not wait for the socket to finish closing (can take a long time). Immediately call
        // all close listeners with a fake event.
        var fakeCloseEvent = { type: 'close', code: code, reason: reason, wasClean: true }
        self.dispatchEvent(fakeCloseEvent)
        // Remove close listener as we do not want to receive the actual close event (prevent notifying the listeners twice)
        realWs.removeEventListener('close', self['handle_close'])
      }

      self.open()
    }

    function reconnect(event) {
      if (event.code === 1000 || explicitlyClosed) {
        attempts = 0
        return
      }

      var delay = opts.shouldReconnect(event, self)
      if (typeof delay === 'number') {
        pendingReconnect = setTimeout(newWebSocket, delay)
      }
    }

    Object.defineProperty(self, 'listeners', {
      value: {
        open: [function(event) {
          if (connectTimeout) {
            clearTimeout(connectTimeout)
            connectTimeout = null
          }
          event.reconnects = ++reconnects
          event.attempts = attempts
          attempts = 0
        }],
        close: [reconnect]
      }
    })

    Object.defineProperty(self, 'attempts', {
      get: function() { return attempts },
      enumerable: true
    })

    Object.defineProperty(self, 'reconnects', {
      get: function() { return reconnects },
      enumerable: true
    })

    function newWebSocket() {
      pendingReconnect = null
      realWs = new WebSocket(url, protocols)
      realWs.binaryType = self.binaryType

      attempts++
      self.dispatchEvent(Object.assign(new CustomEvent('connecting'), {
        attempts: attempts,
        reconnects: reconnects
      }))

      connectTimeout = setTimeout(function() {
        connectTimeout = null
        self.dispatchEvent(Object.assign(new CustomEvent('timeout'), {
          attempts: attempts,
          reconnects: reconnects
        }))
      }, opts.timeout)

      ;['open', 'close', 'message', 'error'].forEach(function(stdEvent) {
        // Keep a reference to the handler function so that we can remove handlers
        // later on (e.g. refresh method)
        self['handle_' + stdEvent] = function(event) {
          self.dispatchEvent(event)

          var cb = self['on' + stdEvent]
          if (typeof cb === 'function') {
            return cb.apply(self, arguments)
          }
        }
        realWs.addEventListener(stdEvent, self['handle_' + stdEvent])
      })
    }

    if (opts.automaticOpen) {
      newWebSocket()
    }
  }

  RobustWebSocket.defaultOptions = {
    // the time to wait before a successful connection
    // before the attempt is considered to have timed out
    timeout: 4000,
    // Given a CloseEvent or OnlineEvent and the RobustWebSocket state,
    // should a reconnect be attempted? Return the number of milliseconds to wait
    // to reconnect (or null or undefined to not), rather than true or false
    shouldReconnect: function(event, ws) {
      if (event.code === 1008 || event.code === 1011) return
      return [0, 3000, 10000][ws.attempts]
    },

    // Create and connect the WebSocket when the instance is instantiated.
    // Defaults to true to match standard WebSocket behavior
    automaticOpen: true
  }

  RobustWebSocket.prototype.binaryType = 'blob'

  // Taken from MDN https://developer.mozilla.org/en-US/docs/Web/API/EventTarget
  RobustWebSocket.prototype.addEventListener = function(type, callback) {
    if (!(type in this.listeners)) {
      this.listeners[type] = []
    }
    this.listeners[type].push(callback)
  }

  RobustWebSocket.prototype.removeEventListener = function(type, callback) {
    if (!(type in this.listeners)) {
      return
    }
    var stack = this.listeners[type]
    for (var i = 0, l = stack.length; i < l; i++) {
      if (stack[i] === callback) {
        stack.splice(i, 1)
        return
      }
    }
  }

  RobustWebSocket.prototype.dispatchEvent = function(event) {
    if (!(event.type in this.listeners)) {
      return
    }
    var stack = this.listeners[event.type]
    for (var i = 0, l = stack.length; i < l; i++) {
      stack[i].call(this, event)
    }
  }

  return RobustWebSocket
}, typeof window != 'undefined' ? window : (typeof global != 'undefined' ? global : this));
