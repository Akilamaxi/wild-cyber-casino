import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import Redis from 'ioredis';

@Injectable()
export class PubSubService extends EventEmitter {
  public redisPublisher: Redis | null = null;
  public redisSubscriber: Redis | null = null;
  public isRedisConnected = false;

  constructor() {
    super();
    if (typeof process !== 'undefined' && process.on) {
      process.on('message', (message: any) => {
        console.log('[PubSub] IPC message received from parent process:', message);
        this.emit('message', message);
      });
    }
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

      await this.redisPublisher.ping();
      await this.redisSubscriber.ping();

      this.isRedisConnected = true;
      console.log('[PubSub] Connected to Redis successfully.');

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

  async publish(event: any) {
    if (this.isRedisConnected && this.redisPublisher) {
      try {
        await this.redisPublisher.publish('emergency_events', JSON.stringify(event));
      } catch (err) {
        console.error('[PubSub] Failed to publish message to Redis. Emitting locally.', err);
        this.emit('message', event);
      }
    } else {
      this.emit('message', event);
      
      if (typeof process !== 'undefined' && process.send) {
        process.send(event);
      }
    }
  }
}
