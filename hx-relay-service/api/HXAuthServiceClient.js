const http = require('http');

/**
 * Create HTTP request promise.
 * @param {*} params HTTP params hash.
 * @param {*} postBody OPTIONAL. Attaches to request in the cast of a body.
 * @param {boolean} rejectBadStatus Defaults to true.
 * @returns HTTP request promise.
 */
 let httpRequest = (params, postBody, rejectBadStatus = true) => {
  return new Promise((resolve, reject) =>  {
      var req = http.request(params, res => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return rejectBadStatus ? 
              reject(new Error('(GSC051)')) : 
              resolve({status: res.statusCode})
          }
          let bodyChunks = []

          res.on('data', chunk => {
              bodyChunks.push(chunk);
          })

          res.on('end', function() {
              resolve({
                status: res.statusCode,
                body: Buffer.concat(bodyChunks).toString()
              });
          });
      });

      req.on('error', err => reject(err))
      
      if (postBody) {
          req.write(postBody);
      }

      req.end();
  });
}


/**
 * validate endpoint
 * @returns Promise
 */
exports.validate = (token) => {
    return httpRequest({
      hostname: 'localhost',
      port: '8080',
      path: '/api/validate',
      method: 'GET',
      headers: {
          'user-agent': 'node.js',
          'Cookie': `jwt=${token}`
      }
  })
}
