const EventEmitter = require('events');
const Redis = require('ioredis');

class PubSubManager extends EventEmitter {
  constructor() {
    super();
    this.redisPublisher = null;
    this.redisSubscriber = null;
    this.isRedisConnected = false;
  }

  async connect(redisUrl = 'redis://127.0.0.1:6379') {
    try {
      console.log('[PubSub] Attempting to connect to Redis...');
      
      this.redisPublisher = new Redis(redisUrl, { 
        maxRetriesPerRequest: 1,
        connectTimeout: 1000 
      });
      
      this.redisSubscriber = new Redis(redisUrl, { 
        maxRetriesPerRequest: 1,
        connectTimeout: 1000 
      });

      this.redisPublisher.on('error', () => {
        this.isRedisConnected = false;
      });

      this.redisSubscriber.on('error', () => {
        this.isRedisConnected = false;
      });

      // Test ping
      await this.redisPublisher.ping();
      await this.redisSubscriber.ping();

      this.isRedisConnected = true;
      console.log('[PubSub] Connected to Redis successfully.');

      // Listen on channel
      await this.redisSubscriber.subscribe('emergency_events');
      this.redisSubscriber.on('message', (channel, message) => {
        if (channel === 'emergency_events') {
          try {
            const parsed = JSON.parse(message);
            this.emit('message', parsed);
          } catch (e) {
            this.emit('message', message);
          }
        }
      });

    } catch (e) {
      this.isRedisConnected = false;
      console.log('[PubSub] Redis server not active. Operating on local memory pub/sub event loop.');
    }
  }

  async publish(event) {
    if (this.isRedisConnected && this.redisPublisher) {
      try {
        await this.redisPublisher.publish('emergency_events', JSON.stringify(event));
      } catch (err) {
        console.error('[PubSub] Failed to publish message to Redis. Emitting locally.', err);
        this.emit('message', event);
      }
    } else {
      // Local emit fallback
      this.emit('message', event);
      
      // Node.js IPC fallback if running as a child process
      if (typeof process !== 'undefined' && process.send) {
        process.send(event);
      }
    }
  }
}

const pubSub = new PubSubManager();
module.exports = pubSub;
