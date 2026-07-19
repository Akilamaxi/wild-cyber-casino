import { WebSocketGateway, WebSocketServer, SubscribeMessage, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnModuleInit } from '@nestjs/common';
import { DbService, PubSubService } from '@cyber-casino/shared';
import * as jwt from 'jsonwebtoken';

@WebSocketGateway({
  cors: {
    origin: (process.env.ADMIN_CORS_ORIGINS || 'http://localhost:5174').split(',').map(value => value.trim()),
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  constructor(
    private readonly db: DbService,
    private readonly pubsub: PubSubService
  ) {}

  onModuleInit() {
    this.pubsub.on('message', (message: any) => {
      console.log(`[BACKOFFICE] Relaying Pub/Sub message to WebSockets: ${message.type}`);
      this.server.emit('lottery_events', message);
    });
  }

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token;
      const secret = process.env.JWT_SECRET;
      if (!token || !secret) throw new Error('Missing credentials');
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || 'cyber-casino',
        audience: process.env.JWT_AUDIENCE || 'cyber-casino-api',
      }) as any;
      const user = await this.db.get('SELECT role, status FROM users WHERE LOWER(email) = ?', [
        String(decoded.email || '').toLowerCase(),
      ]);
      if (!user || user.role !== 'ADMIN' || ['FROZEN', 'BANNED'].includes(user.status)) throw new Error('Forbidden');
      client.data.user = { email: decoded.email, role: user.role };
    } catch {
      client.disconnect(true);
      return;
    }
    console.log(`[BACKOFFICE] WebSocket client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`[BACKOFFICE] WebSocket client disconnected: ${client.id}`);
  }

  @SubscribeMessage('request_initial_state')
  async handleInitialStateRequest(client: Socket) {
    try {
      const activeDraw = await this.db.get('SELECT id, state, timestamp FROM lottery_draws ORDER BY id DESC LIMIT 1');
      const ksSetting = await this.db.get("SELECT value FROM game_settings WHERE key = 'kill_switch_active'");
      
      client.emit('initial_state', {
        draw: activeDraw,
        killSwitchActive: ksSetting ? ksSetting.value === 'true' : false
      });
    } catch (err) {
      console.error(err);
    }
  }
}
