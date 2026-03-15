// MV3-safe setImmediate polyfill
// Replaces the default setimmediate package which uses new Function() and
// createElement("script") — both violate Chrome MV3 remotely hosted code policy.
(function (global) {
  "use strict";

  if (global.setImmediate) {
    return;
  }

  var nextHandle = 1;
  var tasksByHandle = {};
  var currentlyRunningATask = false;

  function setImmediate(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("setImmediate requires a function argument");
    }
    var args = new Array(arguments.length - 1);
    for (var i = 0; i < args.length; i++) {
      args[i] = arguments[i + 1];
    }
    tasksByHandle[nextHandle] = { callback: callback, args: args };
    registerImmediate(nextHandle);
    return nextHandle++;
  }

  function clearImmediate(handle) {
    delete tasksByHandle[handle];
  }

  function run(handle) {
    if (currentlyRunningATask) {
      setTimeout(run, 0, handle);
    } else {
      var task = tasksByHandle[handle];
      if (task) {
        currentlyRunningATask = true;
        try {
          task.callback.apply(undefined, task.args);
        } finally {
          clearImmediate(handle);
          currentlyRunningATask = false;
        }
      }
    }
  }

  // Use MessageChannel (available in all modern browsers and extensions)
  var registerImmediate;
  if (typeof MessageChannel !== "undefined") {
    var channel = new MessageChannel();
    channel.port1.onmessage = function (event) {
      run(event.data);
    };
    registerImmediate = function (handle) {
      channel.port2.postMessage(handle);
    };
  } else {
    // Fallback to setTimeout (safe for MV3)
    registerImmediate = function (handle) {
      setTimeout(run, 0, handle);
    };
  }

  global.setImmediate = setImmediate;
  global.clearImmediate = clearImmediate;
}(typeof self !== "undefined" ? self : typeof global !== "undefined" ? global : this));
