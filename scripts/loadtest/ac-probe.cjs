const autocannon = require('autocannon');
let n = 70000;
const path = process.argv[2];
autocannon({ url: 'http://localhost:3301' + path, connections: 16, duration: 10,
  setupClient: (client) => { client.setHeaders({ 'x-forwarded-for': '10.7.' + ((n >> 8) & 255) + '.' + (n++ & 255) }); client.on('response', () => client.setHeaders({ 'x-forwarded-for': '10.' + ((n >> 16) & 255) + '.' + ((n >> 8) & 255) + '.' + (n++ & 255) })); },
}, (err, r) => {
  if (err) throw err;
  console.log(path, 'rps', r.requests.average, 'p50', r.latency.p50, 'p97.5', r.latency.p97_5, 'p99', r.latency.p99, 'max', r.latency.max, 'non2xx', r.non2xx, 'errors', r.errors, 'timeouts', r.timeouts);
});
