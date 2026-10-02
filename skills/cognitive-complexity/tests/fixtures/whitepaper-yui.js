// Whitepaper v1.7 Appendix C: from model.js in YUI (JavaScript, verbatim).
/* global EVT_ERROR, EVT_SAVE */
var Model = {
  save: function (options, callback) {
    var self = this;

    if (typeof options === 'function') { // +1
      callback = options;
      options = {};
    }

    options || (options = {}); // +1

    self._validate(self.toJSON(), function (err) {
      if (err) { // +2 (nesting = 1)
        callback && callback.call(null, err); // +1
        return;
      }

      self.sync(self.isNew() ? 'create' : 'update', // +2 (nesting = 1)
        options, function (err, response) {
          var facade = {
              options : options,
              response: response
            },
            parsed;

          if (err) { // +3 (nesting = 2)
            facade.error = err;
            facade.src   = 'save';
            self.fire(EVT_ERROR, facade);

          } else { // +1
            if (!self._saveEvent) { // +4 (nesting = 3)
              self._saveEvent = self.publish(EVT_SAVE, {
                preventable: false
              });
            }

            if (response) { // +4 (nesting = 3)
              parsed = facade.parsed = self._parse(response);
              self.setAttrs(parsed, options);
            }

            self.changed = {};
            self.fire(EVT_SAVE, facade);
          }

          callback && callback.apply(null, arguments); // +1
        });
    });
    return self;
  } // total complexity = 20
};
